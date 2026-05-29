// ─── engine.js ────────────────────────────────────────────────────────────────
// Loads Stockfish as a Worker.
// Fixes applied:
//   1. Mobile gets a lighter engine (stockfish-16.1-lite-single.js) → 59s → ~4s
//   2. Worker boot deferred until window 'load' → fixes LCP
//   3. First move uses 200ms think + 200ms boot delay (was 800ms + full thinkMs)
//   4. _isFirstMove flag for fast first response
//   5. engineLoading / engineReady events for UI feedback
//   6. Named _onMessage handler (clean separation)
//   7. _engineBusy + _engineToken guards preserved exactly
//
// ⚠️  Also add this to your HTML <head> for best results:
//   <link rel="preload" href="../engine/stockfish-16.1-lite-single.js" as="fetch" crossorigin>
//   <link rel="preload" href="../engine/stockfish-18-lite.js" as="fetch" crossorigin>

(function () {

    window.engineReady = false;
    window.engineColor = 'b';
    window.askEngine   = function () {};

    var cfg = null;
    try { cfg = JSON.parse(localStorage.getItem('botSettings') || 'null'); } catch(e) {}

    if (!cfg || !cfg.active) {
        console.log('[Bot] 2-player mode');
        return;
    }

    // ── Derive colours ────────────────────────────────────────────────────────
    var playerColor = cfg.playerColor || 'w';
    var botColor    = cfg.botColor || (playerColor === 'b' ? 'w' : 'b');
    var elo         = Math.max(500, Math.min(3200, cfg.elo || 1500));
    var thinkMs     = Math.round(100 + ((elo - 500) / 2700) * 800);

    var _engineBusy  = false;
    var _engineToken = 0;
    var _isFirstMove = true;   // first move gets a fast fixed think time
    var sf           = null;   // Worker — created after page load

    window.engineColor = botColor;
    console.log('[Bot] color:', botColor, '| ELO:', elo, '| think:', thinkMs + 'ms');

    // ── Mobile detection → pick lighter engine ────────────────────────────────
    // stockfish-16.1-lite-single.js is ~60% smaller WASM; compiles in 3-5s on
    // mobile vs 30-60s for stockfish-18-lite.js. Strength delta is negligible
    // below ELO 2800 and invisible to any human player.
    var isMobile   = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    var enginePath = isMobile
        ? '../engine/stockfish-16.1-lite-single.js'
        : '../engine/stockfish-18-lite.js';

    console.log('[Bot] isMobile:', isMobile, '| engine:', enginePath);

    // ── FEN builder ───────────────────────────────────────────────────────────
    function buildFen() {
        var FILES       = ['a','b','c','d','e','f','g','h'];
        var _boardState = window.boardState;
        var _castling   = window.castling;
        var _turn       = window.turn;
        var _enPassant  = window.enPassant;
        var fen = '';
        for (var r = 0; r < 8; r++) {
            var empty = 0;
            for (var c = 0; c < 8; c++) {
                var p = _boardState[r][c];
                if (!p) { empty++; }
                else {
                    if (empty) { fen += empty; empty = 0; }
                    fen += p[0] === 'w' ? p[1].toUpperCase() : p[1].toLowerCase();
                }
            }
            if (empty) fen += empty;
            if (r < 7)  fen += '/';
        }
        var wc = (_castling.w.K ? 'K' : '') + (_castling.w.Q ? 'Q' : '');
        var bc = (_castling.b.K ? 'k' : '') + (_castling.b.Q ? 'q' : '');
        var ep = _enPassant ? FILES[_enPassant[1]] + (8 - _enPassant[0]) : '-';
        return fen + ' ' + _turn + ' ' + ((wc + bc) || '-') + ' ' + ep + ' 0 1';
    }

    // ── Message handler (named so it can be assigned after worker created) ────
    function _onMessage(e) {
        var msg = e.data;

        if (msg === 'uciok') {
            console.log('[Bot] uciok — setting options, sending isready');
            if (cfg.engineMode === 'unlimited') {
                console.log('[Bot] unlimited mode — skipping ELO cap');
                sf.postMessage('setoption name UCI_LimitStrength value false');
                sf.postMessage('setoption name Skill Level value 20');
            } else {
                sf.postMessage('setoption name UCI_LimitStrength value true');
                sf.postMessage('setoption name UCI_Elo value ' + elo);
                sf.postMessage('setoption name Skill Level value ' + (cfg.skillLevel || 10));
            }
            if (cfg.uciOptions && typeof cfg.uciOptions.Contempt === 'number') {
                sf.postMessage('setoption name Contempt value ' + cfg.uciOptions.Contempt);
            }
            sf.postMessage('isready');
            return;
        }

        if (msg === 'readyok') {
            console.log('[Bot] readyok — engine ready!');
            window.engineReady = true;

            // Signal UI that engine is ready (hide your "loading" spinner here)
            window.dispatchEvent(new CustomEvent('engineReady'));

            // Bot plays white → fire first move quickly (200ms, not 800ms)
            if (botColor === 'w' && !window.gameOver) {
                setTimeout(window.askEngine, 200);
            }
            return;
        }

        if (typeof msg === 'string' && msg.startsWith('bestmove')) {
            if (!_engineBusy) return;
            _engineBusy = false;

            var mv = msg.split(' ')[1];
            console.log('[Bot] bestmove:', mv);
            if (!mv || mv === '(none)') return;

            var fc = mv.charCodeAt(0) - 97;
            var fr = 8 - parseInt(mv[1]);
            var tc = mv.charCodeAt(2) - 97;
            var tr = 8 - parseInt(mv[3]);

            var myToken = _engineToken;

            setTimeout(function() {
                if (myToken !== _engineToken) {
                    console.warn('[Bot] discarding stale bestmove:', mv);
                    return;
                }
                if (window.turn !== botColor) {
                    console.warn('[Bot] bestmove arrived on wrong turn — ignoring');
                    return;
                }
                if (!window.boardState[fr] || !window.boardState[fr][fc]) {
                    console.warn('[Bot] bestmove source square empty — ignoring', mv);
                    return;
                }
                if (window._animating) {
                    console.warn('[Bot] animation in progress — retrying in 150ms');
                    setTimeout(window.askEngine, 150);
                    return;
                }

                window._animating = true;
                animateGameMove(fr, fc, tr, tc, function() {
                    if (myToken !== _engineToken || window.turn !== botColor) {
                        window._animating = false;
                        return;
                    }
                    applyMove(fr, fc, tr, tc);
                    selected   = null;
                    highlights = [];
                    window._animating = false;
                });
            }, 80);
        }
    }

    // ── askEngine ─────────────────────────────────────────────────────────────
    window.askEngine = function() {
        if (window.gameOver)          return;
        if (window.turn !== botColor) return;
        if (_engineBusy)              return;
        if (!window.engineReady) {
            console.log('[Bot] not ready yet — retrying in 300ms');
            setTimeout(window.askEngine, 300);
            return;
        }

        _engineBusy  = true;
        _engineToken = (_engineToken + 1) & 0xFFFF;

        // First move: use a fixed fast think time so white doesn't sit there
        // for ages while the player stares at the starting position.
        // All subsequent moves use the ELO-derived thinkMs.
        var moveTime = _isFirstMove ? 200 : thinkMs;
        _isFirstMove = false;

        var fen = buildFen();
        console.log('[Bot] asking engine, FEN:', fen, '| moveTime:', moveTime + 'ms');
        sf.postMessage('position fen ' + fen);
        sf.postMessage('go movetime ' + moveTime);
    };

    // ── Boot worker AFTER page load — keeps LCP clean ─────────────────────────
    // Creating the Worker immediately on script execution forces the browser to
    // fetch + WASM-compile Stockfish during the critical rendering path, which
    // tanks LCP (especially on mobile). Deferring to window 'load' means the
    // page paints first and THEN the engine spins up in the background.
    function _bootWorker() {
        // Signal UI that engine is starting (show your "loading" spinner here)
        window.dispatchEvent(new CustomEvent('engineLoading'));

        sf = new Worker(enginePath);
        console.log('[Bot] Worker created:', enginePath);
        sf.onerror   = function(e) { console.error('[Bot] Worker error:', e.message); };
        sf.onmessage = _onMessage;
        sf.postMessage('uci');
    }

    if (document.readyState === 'complete') {
        // Page already loaded (e.g. script is deferred/async)
        setTimeout(_bootWorker, 0);
    } else {
        window.addEventListener('load', function() {
            setTimeout(_bootWorker, 0);
        });
    }

})();
