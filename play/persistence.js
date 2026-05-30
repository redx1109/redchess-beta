// ─── persistence.js ────────────────────────────────────────────────────────────
// State persistence, move navigation, promotion dialog, and end-game logic.
// Depends on: bot.js (for _getPlayerName), game.js globals (boardState etc.)
// Load AFTER bot.js and movelogic.js, BEFORE engine.js.
// ──────────────────────────────────────────────────────────────────────────────

// ─── Game over ─────────────────────────────────────────────────────────────────

function endGame(message) {
    gameOver = true;
    window.gameOver = true;

    const indicator = document.getElementById("turnIndicator");
    if (indicator) {
        indicator.textContent = message;
        indicator.className   = "turn-indicator game-over-indicator";
    }

    const resignBtn  = document.getElementById("resignBtn");
    const analyzeBtn = document.getElementById("analyzeBtn");
    if (resignBtn)  resignBtn.style.display  = "none";
    if (analyzeBtn) analyzeBtn.style.display = "block";

    saveGameState();
    saveGameForAnalysis(message);
}

function resignGame() {
    if (gameOver) return;
    const _resignerName = _getPlayerName(turn);
    const _winnerName   = _getPlayerName(turn === 'w' ? 'b' : 'w');
    endGame(`${_resignerName} resigned — ${_winnerName} wins`);
}

function saveGameForAnalysis(result) {
    let pgnResult = '*';
    if (result.includes('White wins') || result.includes('1-0')) pgnResult = '1-0';
    else if (result.includes('Black wins') || result.includes('0-1')) pgnResult = '0-1';
    else if (result.includes('Draw') || result.includes('½')) pgnResult = '1/2-1/2';

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

    if (!document.getElementById('_promoStyles')) {
        const st = document.createElement('style');
        st.id = '_promoStyles';
        st.textContent = `
            @keyframes promoFadeIn { from { opacity:0; } to { opacity:1; } }
            @keyframes promoPop    { from { transform:scale(.8); opacity:0; } to { transform:scale(1); opacity:1; } }
            #promotionOverlay .promo-box {
                background: #1e1e1e; border: 1px solid rgba(255,255,255,0.12);
                border-radius: 14px; padding: 22px 26px 18px;
                display: flex; flex-direction: column; align-items: center; gap: 16px;
                box-shadow: 0 16px 48px rgba(0,0,0,0.85);
                animation: promoPop 0.18s cubic-bezier(.2,1.4,.4,1);
            }
            #promotionOverlay .promo-title {
                color: rgba(255,255,255,0.75); font-size: 13px;
                letter-spacing: 0.08em; text-transform: uppercase; font-family: sans-serif;
            }
            #promotionOverlay .promo-pieces { display: flex; gap: 10px; }
            #promotionOverlay .promo-btn {
                width: 76px; height: 84px; cursor: pointer; background: #2d2d2d;
                border: 2px solid transparent; border-radius: 10px;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center; gap: 5px;
                transition: background 0.13s, border-color 0.13s, transform 0.12s;
            }
            #promotionOverlay .promo-btn:hover {
                background: #3d3d3d; border-color: rgba(255,255,255,0.3); transform: translateY(-2px);
            }
            #promotionOverlay .promo-btn img { width: 52px; height: 52px; pointer-events: none; display: block; }
            #promotionOverlay .promo-btn span {
                color: rgba(255,255,255,0.5); font-size: 10px; font-family: sans-serif; letter-spacing: 0.05em;
            }
        `;
        document.head.appendChild(st);
    }

    const box   = document.createElement('div');
    box.className = 'promo-box';
    const title = document.createElement('div');
    title.className   = 'promo-title';
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
        btn.addEventListener('click', () => { overlay.remove(); onChoose(p); });
        row.appendChild(btn);
    });

    box.appendChild(row);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); onChoose('Q'); }
    });
    document.body.appendChild(overlay);
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
                    img.src           = `../../pieces/${pieceFolder}/${piece}.png`;
                    img.className     = "piece";
                    img.draggable     = false;
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

    const isStep  = Math.abs(idx - prevIdx) === 1;
    const canAnim = isStep && snap.from && snap.to;

    if (canAnim) {
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

function exitHistory() {
    cancelAnimation();
    viewIdx    = -1;
    selected   = null;
    highlights = [];
    renderBoard();
}

// ─── State persistence ─────────────────────────────────────────────────────────

function saveGameState() {
    try {
        localStorage.setItem('chessGameState', JSON.stringify({
            boardState, castling, turn, enPassant,
            posHistory, moveLog, gameOver
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

    if (saved.gameOver) { clearSavedState(); return false; }

    boardState  = saved.boardState;
    castling    = saved.castling;
    turn        = saved.turn;
    enPassant   = saved.enPassant;
    posHistory  = saved.posHistory;
    moveLog     = saved.moveLog || [];
    gameOver    = saved.gameOver || false;

    window.boardState = boardState;
    window.castling   = castling;
    window.turn       = turn;
    window.enPassant  = enPassant;
    window.gameOver   = gameOver;

    const indicator = document.getElementById("turnIndicator");
    if (indicator && !gameOver) {
        indicator.textContent = turn === 'w' ? "White's Turn" : "Black's Turn";
        indicator.className   = "turn-indicator " + (turn === 'w' ? "white-turn" : "black-turn");
    }

    if (gameOver) {
        const resignBtn  = document.getElementById("resignBtn");
        const analyzeBtn = document.getElementById("analyzeBtn");
        if (resignBtn)  resignBtn.style.display  = "none";
        if (analyzeBtn) analyzeBtn.style.display = "block";
    }

    const log = document.getElementById("moveLog");
    if (log) {
        log.innerHTML = "";
        moveLog.forEach(({ notation, color, moveIdx }) => {
            if (color === 'w') {
                const num     = log.children.length + 1;
                const entryEl = document.createElement("div");
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

window.goToGameMove      = goToGameMove;
window.exitHistory       = exitHistory;
window.saveGameState     = saveGameState;
window.loadGameState     = loadGameState;
window.clearSavedState   = clearSavedState;
window.endGame           = endGame;
window.resignGame        = resignGame;
window.showPromotionDialog = showPromotionDialog;
window.saveGameForAnalysis = saveGameForAnalysis;
