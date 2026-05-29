// ─── Game state ────────────────────────────────────────────────────────────────

let boardState = [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR']
];

let castling   = { w: { K: true, Q: true }, b: { K: true, Q: true } };
let turn       = 'w';
let selected   = null;
let highlights = [];
let enPassant  = null;
let didDrag    = false;
let moveLog    = []; // [{notation, color, moveIdx}] — persisted for log rebuild

// Expose shared state on window so engine.js (a separate script) can read them.
// engine.js uses: boardState, castling, turn, enPassant, gameOver, _flipped.
// game.html may also reference _flipped before this script runs.
window.boardState = boardState;
window.castling   = castling;
window.turn       = turn;
window.enPassant  = enPassant;

// ─── Position history (for move navigation) ────────────────────────────────────

let posHistory = [{ board: JSON.parse(JSON.stringify(boardState)), from: null, to: null }];
let viewIdx    = -1; // -1 = live game, >= 0 = viewing history

// ─── Bot / board-flip config ───────────────────────────────────────────────────

var _botCfg    = null;
try { _botCfg = JSON.parse(localStorage.getItem('botSettings') || 'null'); } catch(e) {}
var _botActive  = !!(_botCfg && _botCfg.active);
var _playerCol  = _botActive ? (_botCfg.playerColor || 'w') : null;
var _flipped = window._flipped || (_playerCol === 'b');   // flip board when player chose black
window._flipped = _flipped;

// ─── Player name helpers ───────────────────────────────────────────────────────
 
function _getPlayerName(color) {
    const me      = (typeof getUsername === 'function' && getUsername()) || 'Player';
    const botName = (typeof getBotName  === 'function' && getBotName())  || 'Bot';
    if (_botActive) {
        return color === _playerCol ? me : botName;
    }
    // Local friend game — username is White by convention
    return color === 'w' ? me : 'Opponent';
}

// ─── Fix: re-stamp bot name on opponent nameplate after updatePlayerBars runs ──

function _fixBotOpponentName() {
    if (!_botActive || !_botCfg) return;
    const bot      = (typeof getBotById === 'function') ? getBotById(_botCfg.botId) : null;
    const nameEl   = document.getElementById('opponentName');
    const avatarEl = document.getElementById('opponentAvatar');
    const eloEl    = document.getElementById('opponentElo');
    if (nameEl)   nameEl.textContent   = bot ? bot.name      : 'Bot';
    if (avatarEl) avatarEl.textContent = bot ? bot.avatar    : '🤖';
    if (eloEl)    eloEl.textContent    = bot ? `~${bot.elo}` : '';
}

// ─── Settings ──────────────────────────────────────────────────────────────────

const settings    = JSON.parse(localStorage.getItem("chessSettings") || "{}");
const boardTheme  = settings.board     || "gold";
const pieceFolder = settings.piece     || "default";
const moveStyle   = settings.moveStyle || "both";
const boardShadow = settings.shadow    || "on";

// ─── Low-end / slow-network detection ─────────────────────────────────────────
// hardwareConcurrency ≤ 2 or deviceMemory ≤ 2 GB → treat as low-end
const _isLowEnd = !!(
    (navigator.hardwareConcurrency != null && navigator.hardwareConcurrency <= 2) ||
    (navigator.deviceMemory        != null && navigator.deviceMemory        <= 2)
);
window._isLowEnd = _isLowEnd;

// ─── Eager image preload (eliminates pop-in on slow networks) ─────────────────
// All 12 piece images + board texture are fetched now, before any move is made.
(function preloadAssets() {
    const pieces = ['wP','wR','wN','wB','wQ','wK','bP','bR','bN','bB','bQ','bK'];
    pieces.forEach(p => { const img = new Image(); img.src = `../../pieces/${pieceFolder}/${p}.png`; });
    const bg = new Image(); bg.fetchPriority = "high"; bg.src = `../../boards/${boardTheme}.jpg`;
})();

// ─── Sounds ────────────────────────────────────────────────────────────────────

const sounds = {
    move:    new Audio("../../sounds/move.mp3"),
    capture: new Audio("../../sounds/capture.mp3"),
};
function playSound(name) {
    sounds[name].currentTime = 0;
    sounds[name].play();
}

// ─── DOM ───────────────────────────────────────────────────────────────────────

const boardEl = document.getElementById("board");
boardEl.style.backgroundImage = `url('../../boards/${boardTheme}.jpg')`;
boardEl.style.backgroundSize  = "100% 100%";
if (boardShadow === "off") boardEl.style.boxShadow = "none";

// Delegated click handler — lives on boardEl which is never recreated,
// so it survives renderBoard() calls that replace innerHTML.
boardEl.addEventListener("click", (e) => {
    const sq = e.target.closest(".square");
    if (!sq) return;
    handleClick(parseInt(sq.dataset.row), parseInt(sq.dataset.col));
});

// ─── Apply a move ──────────────────────────────────────────────────────────────

function applyMove(fromRow, fromCol, toRow, toCol) {
     clearCheck();
    const piece  = boardState[fromRow][fromCol];
    if (!piece) {
        console.error(`[applyMove] no piece at (${fromRow},${fromCol}) — move ignored`);
        return;
    }
    const color  = piece[0];
    const ptype  = piece[1];

    // en passant capture
    if (ptype === 'P' && enPassant && toRow === enPassant[0] && toCol === enPassant[1]) {
        boardState[color === 'w' ? toRow + 1 : toRow - 1][toCol] = null;
    }

    // detect castling before moving
    let isCastle = null;
    if (ptype === 'K' && fromCol === 4) {
        if (toCol === 6) isCastle = 'K';
        if (toCol === 2) isCastle = 'Q';
    }

    // capture (read before overwriting)
    const captured = boardState[toRow][toCol];
    let notation = toAlgebraic(boardState, piece, fromRow, fromCol, toRow, toCol, captured, isCastle); 
    // castling — move the rook
    if (ptype === 'K') {
        const backRow = color === 'w' ? 7 : 0;
        if (fromCol === 4 && toCol === 6) {
            boardState[backRow][5] = boardState[backRow][7];
            boardState[backRow][7] = null;
        } else if (fromCol === 4 && toCol === 2) {
            boardState[backRow][3] = boardState[backRow][0];
            boardState[backRow][0] = null;
        }
        castling[color].K = false;
        castling[color].Q = false;
    }

    // rook moved — lose castling right
    if (ptype === 'R') {
        const backRow = color === 'w' ? 7 : 0;
        if (fromRow === backRow && fromCol === 7) castling[color].K = false;
        if (fromRow === backRow && fromCol === 0) castling[color].Q = false;
    }

    // rook captured — opponent loses castling right
    if (captured && captured[1] === 'R') {
        const enemy     = color === 'w' ? 'b' : 'w';
        const enemyBack = color === 'w' ? 0 : 7;
        if (toRow === enemyBack && toCol === 7) castling[enemy].K = false;
        if (toRow === enemyBack && toCol === 0) castling[enemy].Q = false;
    }

    // en passant target
    enPassant = (ptype === 'P' && Math.abs(toRow - fromRow) === 2)
        ? [(fromRow + toRow) / 2, toCol] : null;
    window.enPassant = enPassant;

    // make the move
    boardState[toRow][toCol]     = piece;
    boardState[fromRow][fromCol] = null;

    // ── Promotion ──────────────────────────────────────────────────────────────
    // Everything from here until end-of-function is deferred so the human player
    // can pick their promotion piece via a dialog first.
    const isPromotion = ptype === 'P' && (toRow === 0 || toRow === 7);

    const _continueAfterPromotion = (promoType) => {
        if (promoType) {
            boardState[toRow][toCol] = color + promoType;
            notation += '=' + promoType;
        }

        // save snapshot AFTER move (and promotion) is fully applied
        posHistory.push({
            board: JSON.parse(JSON.stringify(boardState)),
            from:  [fromRow, fromCol],
            to:    [toRow, toCol]
        });

        // sound
        playSound(captured ? "capture" : "move");

        // move log
        const log = document.getElementById("moveLog");
        const _moveIdx = posHistory.length - 1;
        moveLog.push({ notation, color: turn, moveIdx: _moveIdx });

        if (log) {
            if (turn === 'w') {
                const num   = log.children.length + 1;
                const entry = document.createElement("div");
                entry.classList.add("move-entry");
                entry.innerHTML = `<span class="move-num">${num}.</span><span class="move-w" data-move-idx="${_moveIdx}">${notation}</span><span class="move-b"></span>`;
                entry.querySelector(".move-w").addEventListener("click", () => goToGameMove(_moveIdx));
                log.appendChild(entry);
            } else {
                const last = log.lastElementChild;
                if (last) {
                    const span = last.querySelector(".move-b");
                    span.textContent = notation;
                    span.dataset.moveIdx = _moveIdx;
                    span.addEventListener("click", () => goToGameMove(_moveIdx));
                }
            }
            log.scrollTop = log.scrollHeight;
        }

        // turn indicator
        const next      = turn === 'w' ? 'b' : 'w';
        const indicator = document.getElementById("turnIndicator");
        if (indicator) {
            indicator.textContent = `${_getPlayerName(next)}'s Turn`;
            indicator.className   = "turn-indicator " + (next === 'w' ? "white-turn" : "black-turn");
        }

        turn = next;
        window.turn = turn;

        // check for checkmate / stalemate
        const allMoves = [];
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (boardState[r][c] && boardState[r][c][0] === next)
                    allMoves.push(...getLegalMoves(boardState, r, c, castling, enPassant));

        if (allMoves.length === 0) {
            if (inCheck(boardState, next)) {
                endGame(`Checkmate — ${_getPlayerName(next === 'w' ? 'b' : 'w')} wins`);
            } else {
                endGame('Stalemate — Draw');
            }
            return;
        }
        saveGameState();
        renderBoard();

        // ── Check animation — runs after renderBoard so the king square exists in DOM
        if (inCheck(boardState, next)) {
            const kingPos = findKing(boardState, next);
            if (kingPos) {
                const kingSq = boardEl.querySelector(`[data-row="${kingPos[0]}"][data-col="${kingPos[1]}"]`);
                if (kingSq) enterCheck(kingSq);
            }
        }

        // ── Ask engine.js to respond (bot's turn).
        if (typeof askEngine === "function") {
            setTimeout(() => askEngine(), 100);
        }
    };

    if (isPromotion) {
        // Bot (or engine) always promotes to queen automatically.
        // Human player gets the pick-a-piece dialog.
        const isHumanTurn = !_botActive || turn === _playerCol;
        if (isHumanTurn) {
            _animating = true;   // block further input while dialog is open
            renderBoard();       // show pawn sitting on the back rank first
            showPromotionDialog(color, (promoType) => {
                _animating = false;
                _continueAfterPromotion(promoType);
            });
        } else {
            _continueAfterPromotion('Q');   // bot promotes to queen
        }
    } else {
        _continueAfterPromotion(null);
    }
}

// ─── Promotion dialog ──────────────────────────────────────────────────────────

function showPromotionDialog(color, onChoose) {
    const choices = ['Q', 'R', 'B', 'N'];
    const labels  = { Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' };

    const overlay = document.createElement('div');
    overlay.id = 'promotionOverlay';
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0',
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: '9999',
        animation: 'promoFadeIn 0.15s ease'
    });

    // Inject the fade-in keyframe once
    if (!document.getElementById('_promoStyles')) {
        const st = document.createElement('style');
        st.id = '_promoStyles';
        st.textContent = `
            @keyframes promoFadeIn { from { opacity:0; } to { opacity:1; } }
            @keyframes promoPop    { from { transform:scale(.8); opacity:0; } to { transform:scale(1); opacity:1; } }
            #promotionOverlay .promo-box {
                background: #1e1e1e;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 14px;
                padding: 22px 26px 18px;
                display: flex; flex-direction: column; align-items: center; gap: 16px;
                box-shadow: 0 16px 48px rgba(0,0,0,0.85);
                animation: promoPop 0.18s cubic-bezier(.2,1.4,.4,1);
            }
            #promotionOverlay .promo-title {
                color: rgba(255,255,255,0.75); font-size: 13px;
                letter-spacing: 0.08em; text-transform: uppercase; font-family: sans-serif;
            }
            #promotionOverlay .promo-pieces {
                display: flex; gap: 10px;
            }
            #promotionOverlay .promo-btn {
                width: 76px; height: 84px; cursor: pointer;
                background: #2d2d2d;
                border: 2px solid transparent;
                border-radius: 10px;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center; gap: 5px;
                transition: background 0.13s, border-color 0.13s, transform 0.12s;
            }
            #promotionOverlay .promo-btn:hover {
                background: #3d3d3d; border-color: rgba(255,255,255,0.3);
                transform: translateY(-2px);
            }
            #promotionOverlay .promo-btn img {
                width: 52px; height: 52px; pointer-events: none; display: block;
            }
            #promotionOverlay .promo-btn span {
                color: rgba(255,255,255,0.5); font-size: 10px;
                font-family: sans-serif; letter-spacing: 0.05em;
            }
        `;
        document.head.appendChild(st);
    }

    const box = document.createElement('div');
    box.className = 'promo-box';

    const title = document.createElement('div');
    title.className = 'promo-title';
    title.textContent = 'Promote pawn to…';
    box.appendChild(title);

    const row = document.createElement('div');
    row.className = 'promo-pieces';

    choices.forEach(p => {
        const btn = document.createElement('div');
        btn.className = 'promo-btn';

        const img = document.createElement('img');
        img.src = `../../pieces/${pieceFolder}/${color}${p}.png`;

        const lbl = document.createElement('span');
        lbl.textContent = labels[p];

        btn.appendChild(img);
        btn.appendChild(lbl);
        btn.addEventListener('click', () => {
            overlay.remove();
            onChoose(p);
        });
        row.appendChild(btn);
    });

    box.appendChild(row);
    overlay.appendChild(box);

    // Clicking the backdrop dismisses and defaults to queen
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); onChoose('Q'); }
    });

    document.body.appendChild(overlay);
}

// ─── findKing helper ───────────────────────────────────────────────────────────
// Returns [row, col] of the given color's king, or null if not found.
function findKing(board, color) {
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            if (board[r][c] === color + 'K') return [r, c];
    return null;
}

// ─── Game over ─────────────────────────────────────────────────────────────────

let gameOver = false;

function endGame(message) {
    gameOver = true;
    window.gameOver = true;

    const indicator = document.getElementById("turnIndicator");
    if (indicator) {
        indicator.textContent = message;
        indicator.className   = "turn-indicator game-over-indicator";
    }

    // hide resign button, show analyze button
    const resignBtn  = document.getElementById("resignBtn");
    const analyzeBtn = document.getElementById("analyzeBtn");
    if (resignBtn)  resignBtn.style.display  = "none";
    if (analyzeBtn) analyzeBtn.style.display = "block";

    saveGameState();

    // save game data for analysis
    saveGameForAnalysis(message);
}

function resignGame() {
    if (gameOver) return;
    const _resignerName = _getPlayerName(turn);
    const _winnerName   = _getPlayerName(turn === 'w' ? 'b' : 'w');
    endGame(`${_resignerName} resigned — ${_winnerName} wins`);
}

function saveGameForAnalysis(result) {
    // Derive PGN result tag
    let pgnResult = '*';
    if (result.includes('White wins') || result.includes('1-0')) pgnResult = '1-0';
    else if (result.includes('Black wins') || result.includes('0-1')) pgnResult = '0-1';
    else if (result.includes('Draw') || result.includes('½')) pgnResult = '1/2-1/2';

    // Build move text from the move log DOM (already has algebraic notation)
    const entries = document.querySelectorAll('.move-entry');
    let moveText = '';
    entries.forEach((entry, i) => {
        const wSpan = entry.querySelector('.move-w');
        const bSpan = entry.querySelector('.move-b');
        const num   = i + 1;
        if (wSpan && wSpan.textContent.trim()) moveText += `${num}. ${wSpan.textContent.trim()} `;
        if (bSpan && bSpan.textContent.trim()) moveText += `${bSpan.textContent.trim()} `;
    });

    const now  = new Date();
    const date = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;

    const pgn =
`[Event "Local Game"]
[Site "Red Chess"]
[Date "${date}"]
[White "${_getPlayerName('w')}"]
[Black "${_getPlayerName('b')}"]
[Result "${pgnResult}"]

${moveText.trim()} ${pgnResult}`;
localStorage.setItem('chessAnalysisPGN', pgn);
}

// ─── Move navigation ───────────────────────────────────────────────────────────

function goToGameMove(idx) {
    if (idx < 0 || idx >= posHistory.length) return;
    if (_animating) return;

    const prevIdx = viewIdx === -1 ? posHistory.length - 1 : viewIdx;
    viewIdx = idx;

    const snap = posHistory[idx];

    const renderSnap = () => {
        boardEl.style.backgroundImage = `url('../../boards/${boardTheme}.jpg')`;
        boardEl.style.backgroundSize  = "100% 100%";

        const frag = document.createDocumentFragment();
        const b    = snap.board;

        for (let _dr = 0; _dr < 8; _dr++) {
            for (let _dc = 0; _dc < 8; _dc++) {
                const row = _flipped ? 7 - _dr : _dr;
                const col = _flipped ? 7 - _dc : _dc;

                const sq = document.createElement("div");
                sq.classList.add("square");
                sq.dataset.row = row;
                sq.dataset.col = col;

                // In-square notation (mirrors renderBoard)
                if (_dc === 0) {
                    const lbl = document.createElement("span");
                    lbl.className   = "sq-notation sq-notation-rank";
                    lbl.textContent = 8 - row;
                    sq.appendChild(lbl);
                }
                if (_dr === 7) {
                    const lbl = document.createElement("span");
                    lbl.className   = "sq-notation sq-notation-file";
                    lbl.textContent = String.fromCharCode(97 + col);
                    sq.appendChild(lbl);
                }

                let bg = "transparent";
                if (snap.from && snap.from[0] === row && snap.from[1] === col) bg = "rgba(255,255,0,0.35)";
                if (snap.to   && snap.to[0]   === row && snap.to[1]   === col) bg = "rgba(255,255,0,0.35)";
                sq.style.background = bg;

                const piece = b[row][col];
                if (piece) {
                    const img = document.createElement("img");
                    img.src      = `../../pieces/${pieceFolder}/${piece}.png`;
                    img.className = "piece";
                    img.draggable = false;
                    img.decoding      = "async";
                    img.fetchPriority = "high";
                    sq.appendChild(img);
                }
                frag.appendChild(sq);
            }
        }

        boardEl.innerHTML = "";
        boardEl.appendChild(frag);

        document.querySelectorAll(".move-w, .move-b").forEach(el => el.classList.remove("active-move"));
        const active = document.querySelector(`[data-move-idx="${idx}"]`);
        if (active) { active.classList.add("active-move"); active.scrollIntoView({ block: "nearest" }); }
    };

    // Animate only when stepping one move at a time
    const isStep  = Math.abs(idx - prevIdx) === 1;
    const canAnim = isStep && snap.from && snap.to;

    if (canAnim) {
        // Forward: slide piece from origin→dest. Backward: slide dest→origin (undo feel).
        const animFrom = idx > prevIdx ? snap.from : snap.to;
        const animTo   = idx > prevIdx ? snap.to   : snap.from;
        _animating = true;
        requestAnimationFrame(() => {
            animateGameMove(animFrom[0], animFrom[1], animTo[0], animTo[1], () => {
            _animating = false;
            renderSnap();
            });
        });
    } else {
        renderSnap();
    }
}

// ─── State persistence (survive page reload) ───────────────────────────────────

function saveGameState() {
    try {
        localStorage.setItem('chessGameState', JSON.stringify({
            boardState,
            castling,
            turn,
            enPassant,
            posHistory,
            moveLog,
            gameOver
        }));
    } catch(e) { console.warn('saveGameState failed', e); }
}

function clearSavedState() {
    localStorage.removeItem('chessGameState');
}

function loadGameState() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem('chessGameState') || 'null'); } catch(e) {}
    if (!saved) return false;

    // If the saved game was already finished, wipe it and start fresh
    if (saved.gameOver) {
        clearSavedState();
        return false;
    }

    boardState  = saved.boardState;
    castling    = saved.castling;
    turn        = saved.turn;
    enPassant   = saved.enPassant;
    posHistory  = saved.posHistory;
    moveLog     = saved.moveLog || [];
    gameOver    = saved.gameOver || false;

    // Keep window.* in sync — engine.js reads these for FEN building
    window.boardState = boardState;
    window.castling   = castling;
    window.turn       = turn;
    window.enPassant  = enPassant;
    window.gameOver   = gameOver;

    // Restore turn indicator
    const indicator = document.getElementById("turnIndicator");
    if (indicator && !gameOver) {
        indicator.textContent = turn === 'w' ? "White's Turn" : "Black's Turn";
        indicator.className   = "turn-indicator " + (turn === 'w' ? "white-turn" : "black-turn");
    }

    // Restore resign/analyze buttons
    if (gameOver) {
        const resignBtn  = document.getElementById("resignBtn");
        const analyzeBtn = document.getElementById("analyzeBtn");
        if (resignBtn)  resignBtn.style.display  = "none";
        if (analyzeBtn) analyzeBtn.style.display = "block";
    }

    // Rebuild move log DOM
    const log = document.getElementById("moveLog");
    if (log) {
        log.innerHTML = "";
        let entryEl = null;
        moveLog.forEach(({ notation, color, moveIdx }) => {
            if (color === 'w') {
                const num = log.children.length + 1;
                entryEl = document.createElement("div");
                entryEl.classList.add("move-entry");
                entryEl.innerHTML = `<span class="move-num">${num}.</span><span class="move-w" data-move-idx="${moveIdx}">${notation}</span><span class="move-b"></span>`;
                entryEl.querySelector(".move-w").addEventListener("click", () => goToGameMove(moveIdx));
                log.appendChild(entryEl);
            } else {
                const last = log.lastElementChild;
                if (last) {
                    const span = last.querySelector(".move-b");
                    span.textContent = notation;
                    span.dataset.moveIdx = moveIdx;
                    span.addEventListener("click", () => goToGameMove(moveIdx));
                }
            }
        });
        log.scrollTop = log.scrollHeight;
    }

    return true;
}

function exitHistory() {
    cancelAnimation();
    viewIdx    = -1;
    selected   = null;
    highlights = [];
    renderBoard();
}

// ─── Mouse drag ────────────────────────────────────────────────────────────────

let dragEl      = null;
let dragFrom    = null;
let _lastDragX  = 0;
let _lastDragY  = 0;
let _dragVX     = 0;   // smoothed velocity
// _hoveredSq, _dimOverlay, getDragSize, createDimOverlay, removeDimOverlay,
// createDragEl, setHoverSquare, clearHoverSquare, spawnLandingEffects,
// shakeDragEl, _dragLoop, _rafId, _curX, _curY, _dragT0 → moveanimation.js

function getSquareAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const sq = el.closest(".square");
    if (!sq) return null;
    return [parseInt(sq.dataset.row), parseInt(sq.dataset.col)];
}

function getSquareElAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest(".square") : null;
}

document.addEventListener("pointermove", (e) => {
    if (!dragEl) return;

    const rawVX = e.clientX - _lastDragX;
    _dragVX    = _dragVX * 0.55 + rawVX * 0.45;
    _lastDragX = e.clientX;
    _lastDragY = e.clientY;
    _curX      = e.clientX;
    _curY      = e.clientY;

    setHoverSquare(getSquareElAt(_curX, _curY));
});

document.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    if (!dragEl || !dragFrom) return;

    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

    clearHoverSquare();
    removeDimOverlay();

    const el   = dragEl;   dragEl  = null;
    const from = dragFrom; dragFrom = null;

    // Block drops after game over
    if (gameOver) {
        el.style.transition = 'opacity 0.15s';
        el.style.opacity    = '0';
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); renderBoard(); }, 150);
        selected = null; highlights = []; renderBoard();
        return;
    }

    const size    = getDragSize();
    const target  = getSquareAt(e.clientX, e.clientY);
    const isValid = target && highlights.some(([r,c]) => r === target[0] && c === target[1]);

    if (isValid) {
        const [toRow, toCol] = target;
        const toEl   = boardEl.querySelector(`[data-row="${toRow}"][data-col="${toCol}"]`);
        const toRect = toEl ? toEl.getBoundingClientRect() : null;

        if (viewIdx !== -1) exitHistory();
        const wasAnimating = _animating;
        const fromRow = from[0], fromCol = from[1];
        selected   = null;
        highlights = [];
        didDrag    = true;

        const doMove = () => {
            if (!wasAnimating) {
                renderBoard();
                applyMove(fromRow, fromCol, toRow, toCol);
            } else {
                renderBoard();
            }
        };

        if (toRect) {
            const cx = toRect.left + toRect.width  / 2;
            const cy = toRect.top  + toRect.height / 2;

            el.style.transition = "transform 0.10s cubic-bezier(.2,1.4,.35,1), filter 0.10s";
            el.style.transform  = `translate3d(${cx - size/2}px, ${cy - size/2}px, 0) scale(1.0) rotate(0deg)`;
            el.style.filter     = "drop-shadow(0 4px 8px rgba(0,0,0,0.55))";

            setTimeout(() => {
                el.style.transition = "opacity 0.1s";
                el.style.opacity    = "0";
                setTimeout(() => { el.remove(); doMove(); }, 110);
            }, 100);
        } else {
            el.remove();
            doMove();
        }

        return;
    }

    // If the pointer was released on the same square it started on, this was a
    // click rather than a drag.  In "both" mode the pointerdown handler calls
    // e.preventDefault(), which suppresses the native click event on own-piece
    // squares — so we must keep the selection here so the user can then click a
    // target square to complete the move (those squares have no pointerdown and
    // will fire a normal click → handleClick).
    const droppedOnOrigin = target && target[0] === from[0] && target[1] === from[1];
    if (droppedOnOrigin) {
        // Fade out the ghost piece and re-render with highlights still visible.
        el.style.transition = "opacity 0.1s";
        el.style.opacity    = "0";
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 110);
        renderBoard();
        return;
    }

    // Invalid drop — shake back to origin then fade
    const sq       = boardEl.querySelector(`[data-row="${from[0]}"][data-col="${from[1]}"]`);
    const origRect = sq ? sq.getBoundingClientRect() : null;

    selected   = null;
    highlights = [];
    renderBoard();

    if (origRect) {
        const ox = origRect.left + origRect.width  / 2;
        const oy = origRect.top  + origRect.height / 2;
        el.style.transition = "transform 0.26s cubic-bezier(.2,1.4,.35,1), filter 0.22s, opacity 0.22s";
        el.style.transform  = `translate3d(${ox - size/2}px, ${oy - size/2}px, 0) scale(1.0) rotate(0deg)`;
        el.style.filter     = "drop-shadow(0 4px 8px rgba(0,0,0,0.5))";
        setTimeout(() => {
            el.style.transition = "opacity 0.15s";
            el.style.opacity    = "0";
            setTimeout(() => el.remove(), 160);
        }, 230);
    } else {
        el.style.transition = "transform 0.18s ease-in, opacity 0.18s";
        el.style.transform  = `translate(${e.clientX - size/2}px, ${e.clientY - size/2}px) scale(0.6)`;
        el.style.opacity    = "0";
        setTimeout(() => el.remove(), 200);
    }
});

// Fix #3: pointercancel fires on tab-switch / touch-interrupt — clean up any orphaned dragEl
document.addEventListener("pointercancel", () => {
    if (!dragEl) return;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    clearHoverSquare();
    removeDimOverlay();
    const el = dragEl; dragEl = null;
    el.remove();
    dragFrom = null; selected = null; highlights = [];
    renderBoard();
});

// ─── Render ────────────────────────────────────────────────────────────────────

function renderBoard() {
    // Build all 64 squares into a fragment — single DOM insertion = zero reflow churn
    const frag = document.createDocumentFragment();

    for (let _dr = 0; _dr < 8; _dr++) {
        for (let _dc = 0; _dc < 8; _dc++) {
            const row = _flipped ? 7 - _dr : _dr;
            const col = _flipped ? 7 - _dc : _dc;

            const sq = document.createElement("div");
            sq.classList.add("square");
            sq.dataset.row = row;
            sq.dataset.col = col;

            // ── In-square coordinate notation (chess.com style) ───────────────
            // Rank numbers: left-edge squares  →  top-left corner
            if (_dc === 0) {
                const lbl = document.createElement("span");
                lbl.className   = "sq-notation sq-notation-rank";
                lbl.textContent = 8 - row;
                sq.appendChild(lbl);
            }
            // File letters: bottom-edge squares  →  bottom-right corner
            if (_dr === 7) {
                const lbl = document.createElement("span");
                lbl.className   = "sq-notation sq-notation-file";
                lbl.textContent = String.fromCharCode(97 + col);
                sq.appendChild(lbl);
            }

            // ── Square highlight ──────────────────────────────────────────────
            const isTarget = highlights.some(([r, c]) => r === row && c === col);
            if (selected && selected[0] === row && selected[1] === col) {
                sq.style.background = "rgba(255,255,0,0.4)";
            } else if (isTarget && boardState[row][col]) {
                sq.style.background = "rgba(255,0,0,0.35)";
            } else {
                sq.style.background = "transparent";
            }

            // ── Move-target dot (CSS class — no inline style overhead) ────────
            if (isTarget && !boardState[row][col]) {
                const dot = document.createElement("div");
                dot.className = "move-dot";
                sq.appendChild(dot);
            }

            // ── Piece image ───────────────────────────────────────────────────
            const piece = boardState[row][col];
            if (piece) {
                const img = document.createElement("img");
                img.src      = `../../pieces/${pieceFolder}/${piece}.png`;
                img.className = "piece";
                img.draggable = false;
                img.decoding      = "async";   // don't block render for image decode
                img.fetchPriority = "high";    // ✅ high priority for LCP paint

                const canDrag = _botActive
                    ? (piece[0] === _playerCol && turn === _playerCol)
                    : (piece[0] === turn);

                if (canDrag && moveStyle !== "click") {
                    sq.addEventListener("pointerdown", (e) => {
                        if (e.button !== 0) return;
                        if (viewIdx !== -1) exitHistory();
                        e.preventDefault();

                        if (dragEl) { dragEl.remove(); dragEl = null; }
                        document.querySelectorAll("img.drag-ghost").forEach(g => g.remove());

                        didDrag    = false;
                        selected   = [row, col];
                        highlights = getLegalMoves(boardState, row, col, castling, enPassant);
                        dragFrom   = [row, col];
                        _lastDragX = e.clientX;
                        _lastDragY = e.clientY;
                        _curX      = e.clientX;
                        _curY      = e.clientY;
                        _dragVX    = 0;
                        dragEl     = createDragEl(img.src, e.clientX, e.clientY);
                        _dragT0    = performance.now();
                        if (_rafId) cancelAnimationFrame(_rafId);
                        _rafId     = requestAnimationFrame(_dragLoop);
                        renderBoard();
                    });
                }

                sq.appendChild(img);
            }

            frag.appendChild(sq);
        }
    }

    // Single DOM mutation — browser sees a complete board in one pass
    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
}

// ─── Click to move ─────────────────────────────────────────────────────────────

function handleClick(row, col) {
    if (moveStyle === "drag") return;
    if (didDrag) { didDrag = false; return; }
    if (gameOver) return;
    if (viewIdx !== -1) { exitHistory(); return; }

    // Block interaction on bot's turn
    if (_botActive && turn !== _playerCol) return;

    const piece = boardState[row][col];

    if (selected && highlights.some(([r, c]) => r === row && c === col)) {
        if (_animating) return;
        _animating = true;
        const fromRow = selected[0], fromCol = selected[1];
        selected   = null;
        highlights = [];
        renderBoard(); // redraw without highlights so ghost has clean origin
        animateGameMove(fromRow, fromCol, row, col, () => {
            applyMove(fromRow, fromCol, row, col); // board state updated first
            _animating = false;                    // unlock AFTER state is committed
            // askEngine is called inside applyMove → it now sees the correct board
        });
        return;
    }

    // Only allow selecting own pieces (in bot mode: only player's color)
    const canSelect = _botActive
        ? (piece && piece[0] === _playerCol && turn === _playerCol)
        : (piece && piece[0] === turn);

    if (canSelect) {
        selected   = [row, col];
        highlights = getLegalMoves(boardState, row, col, castling, enPassant);
        renderBoard();
        return;
    }

    selected   = null;
    highlights = [];
    renderBoard();
}

// ─── Start ─────────────────────────────────────────────────────────────────────

loadGameState();
renderBoard();

// Deferred startup — runs after ALL scripts (moves.js, engine.js, etc.) are loaded.
window.addEventListener('load', () => {
    // ── Show username popup only if no username saved yet, then update bars ──
    const _hasUsername = typeof getUsername === 'function' && getUsername();
    if (!_hasUsername && typeof showUsernamePopup === 'function') {
        showUsernamePopup(() => {
            if (typeof updatePlayerBars === 'function') updatePlayerBars();
            _fixBotOpponentName();
        });
    } else {
        if (typeof updatePlayerBars === 'function') updatePlayerBars();
        _fixBotOpponentName();
    }

    // Restore check overlay if the reloaded game is already in check.
    if (!gameOver && typeof inCheck === 'function' && inCheck(boardState, turn)) {
        const kingPos = findKing(boardState, turn);
        if (kingPos) {
            const kingSq = boardEl.querySelector(`[data-row="${kingPos[0]}"][data-col="${kingPos[1]}"]`);
            if (kingSq) enterCheck(kingSq);
        }
    }

    // Bot goes first if it's its turn on load. Retries at 500/1200/2500/4500ms
    // because personality bots need time for the UCI handshake before accepting a position.
    if (!gameOver && _botActive && turn !== _playerCol) {
        let botFirstMoveFired = false;
        const tryFirstMove = () => {
            if (gameOver || botFirstMoveFired || posHistory.length > 1 || turn === _playerCol) return;
            if (typeof askEngine !== 'function') return;
            botFirstMoveFired = true;
            askEngine();
        };
        setTimeout(tryFirstMove,  500);
        setTimeout(tryFirstMove, 1200);
        setTimeout(tryFirstMove, 2500);
        setTimeout(tryFirstMove, 4500);
    }
});
// ─── Disable swipe-to-navigate on mobile ──────────────────────────────────────
// The swipe-nav gesture calls goToGameMove(). On mobile we track touch direction
// and block goToGameMove from executing when the call originates from a swipe.
// Click calls (from the move log) are unaffected because they don't set the flag.
(function disableMobileSwipeNav() {
    const isMobile = () => window.matchMedia('(max-width: 600px)').matches;

    let _touchStartX = 0;
    let _touchStartY = 0;
    let _blockingSwipe = false;

    document.addEventListener('touchstart', (e) => {
        if (!isMobile()) return;
        _touchStartX = e.touches[0].clientX;
        _touchStartY = e.touches[0].clientY;
        _blockingSwipe = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isMobile()) return;
        const dx = Math.abs(e.touches[0].clientX - _touchStartX);
        const dy = Math.abs(e.touches[0].clientY - _touchStartY);
        if (dx > dy && dx > 20) _blockingSwipe = true;
    }, { passive: true });

    // Wrap goToGameMove: if a horizontal swipe is in progress, swallow the call
    const _origGoToGameMove = goToGameMove;
    window.goToGameMove = function(idx) {
        if (isMobile() && _blockingSwipe) { _blockingSwipe = false; return; }
        _origGoToGameMove(idx);
    };
})();
