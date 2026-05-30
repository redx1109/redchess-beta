// ─── game.js ───────────────────────────────────────────────────────────────────
// Core game state, rendering, drag/click input, and startup.
// Load order in HTML:
//   bots.js → moveanimation.js → persistence.js → game.js → movelogic.js → engine.js
// ──────────────────────────────────────────────────────────────────────────────
// ─── Clear stale online room if this is a bot game ────────────────────────────
if (_botActive && _botCfg && _botCfg.botId) {
    localStorage.removeItem('onlineRoom');
}
// ─── Bot config (read from localStorage after bots.js activateBot) ─────────────

var _botCfg    = null;
try { _botCfg = JSON.parse(localStorage.getItem('botSettings') || 'null'); } catch(e) {}
var _botActive  = !!(_botCfg && _botCfg.active);
var _playerCol  = _botActive ? (_botCfg.playerColor || 'w') : null;
var _flipped = (_playerCol === 'b');
window._flipped = _flipped;

window._botCfg    = _botCfg;
window._botActive = _botActive;
window._playerCol = _playerCol;

// ─── Low-end device detection ──────────────────────────────────────────────────

var _isLowEnd = !!(
    (navigator.hardwareConcurrency != null && navigator.hardwareConcurrency <= 2) ||
    (navigator.deviceMemory        != null && navigator.deviceMemory        <= 2)
);
window._isLowEnd = _isLowEnd;

// ─── Player name helpers ───────────────────────────────────────────────────────

function _getPlayerName(color) {
    const me      = (typeof getUsername === 'function' && getUsername()) || 'Player';
    const botName = (typeof getBotName  === 'function' && getBotName())  || 'Bot';
    if (_botActive) return color === _playerCol ? me : botName;
    return color === 'w' ? me : 'Opponent';
}

function _fixBotOpponentName() {
    if (!_botActive || !_botCfg) return;
    const bot      = (typeof getBotById === 'function') ? getBotById(_botCfg.botId) : null;
    const nameEl   = document.getElementById('opponentName');
    const avatarEl = document.getElementById('opponentAvatar');
    const eloEl    = document.getElementById('opponentElo');
    if (nameEl)   nameEl.textContent   = bot ? bot.name   : 'Bot';
    if (avatarEl) avatarEl.textContent = bot ? bot.avatar : '🤖';
    if (eloEl)    eloEl.textContent    = bot ? `~${bot.elo}` : '';
}

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
let moveLog    = [];
let gameOver   = false;

let posHistory = [{ board: JSON.parse(JSON.stringify(boardState)), from: null, to: null }];
let viewIdx    = -1;

window.boardState = boardState;
window.castling   = castling;
window.turn       = turn;
window.enPassant  = enPassant;
window.gameOver   = gameOver;

// ─── Settings ──────────────────────────────────────────────────────────────────

const settings    = JSON.parse(localStorage.getItem("chessSettings") || "{}");
const boardTheme  = settings.board     || "gold";
const pieceFolder = settings.piece     || "default";
const moveStyle   = settings.moveStyle || "both";
const boardShadow = settings.shadow    || "on";

// ─── Eager image preload ───────────────────────────────────────────────────────

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

boardEl.addEventListener("click", (e) => {
    const sq = e.target.closest(".square");
    if (!sq) return;
    handleClick(parseInt(sq.dataset.row), parseInt(sq.dataset.col));
});

// ─── findKing helper ───────────────────────────────────────────────────────────

function findKing(board, color) {
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            if (board[r][c] === color + 'K') return [r, c];
    return null;
}

// ─── Apply a move ──────────────────────────────────────────────────────────────

function applyMove(fromRow, fromCol, toRow, toCol) {
    clearCheck();
    const piece = boardState[fromRow][fromCol];
    if (!piece) {
        console.error(`[applyMove] no piece at (${fromRow},${fromCol}) — move ignored`);
        return;
    }
    const color = piece[0];
    const ptype = piece[1];

    if (ptype === 'P' && enPassant && toRow === enPassant[0] && toCol === enPassant[1]) {
        boardState[color === 'w' ? toRow + 1 : toRow - 1][toCol] = null;
    }

    let isCastle = null;
    if (ptype === 'K' && fromCol === 4) {
        if (toCol === 6) isCastle = 'K';
        if (toCol === 2) isCastle = 'Q';
    }

    const captured = boardState[toRow][toCol];
    let notation = toAlgebraic(boardState, piece, fromRow, fromCol, toRow, toCol, captured, isCastle);

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

    if (ptype === 'R') {
        const backRow = color === 'w' ? 7 : 0;
        if (fromRow === backRow && fromCol === 7) castling[color].K = false;
        if (fromRow === backRow && fromCol === 0) castling[color].Q = false;
    }

    if (captured && captured[1] === 'R') {
        const enemy     = color === 'w' ? 'b' : 'w';
        const enemyBack = color === 'w' ? 0 : 7;
        if (toRow === enemyBack && toCol === 7) castling[enemy].K = false;
        if (toRow === enemyBack && toCol === 0) castling[enemy].Q = false;
    }

    enPassant = (ptype === 'P' && Math.abs(toRow - fromRow) === 2)
        ? [(fromRow + toRow) / 2, toCol] : null;
    window.enPassant = enPassant;

    boardState[toRow][toCol]     = piece;
    boardState[fromRow][fromCol] = null;

    const isPromotion = ptype === 'P' && (toRow === 0 || toRow === 7);

    const _continueAfterPromotion = (promoType) => {
        if (promoType) {
            boardState[toRow][toCol] = color + promoType;
            notation += '=' + promoType;
        }

        posHistory.push({
            board: JSON.parse(JSON.stringify(boardState)),
            from:  [fromRow, fromCol],
            to:    [toRow, toCol]
        });

        playSound(captured ? "capture" : "move");

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

        const next      = turn === 'w' ? 'b' : 'w';
        const indicator = document.getElementById("turnIndicator");
        if (indicator) {
            indicator.textContent = `${_getPlayerName(next)}'s Turn`;
            indicator.className   = "turn-indicator " + (next === 'w' ? "white-turn" : "black-turn");
        }

        turn = next;
        window.turn = turn;

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

        if (inCheck(boardState, next)) {
            const kingPos = findKing(boardState, next);
            if (kingPos) {
                const kingSq = boardEl.querySelector(`[data-row="${kingPos[0]}"][data-col="${kingPos[1]}"]`);
                if (kingSq) enterCheck(kingSq);
            }
        }

        if (typeof askEngine === "function") {
            setTimeout(() => askEngine(), 100);
        }
    };

    if (isPromotion) {
        const isHumanTurn = !_botActive || turn === _playerCol;
        if (isHumanTurn) {
            _animating = true;
            renderBoard();
            showPromotionDialog(color, (promoType) => {
                _animating = false;
                _continueAfterPromotion(promoType);
            });
        } else {
            _continueAfterPromotion('Q');
        }
    } else {
        _continueAfterPromotion(null);
    }
}

// ─── Mouse drag ────────────────────────────────────────────────────────────────

let dragEl     = null;
let dragFrom   = null;
let _lastDragX = 0;
let _lastDragY = 0;
let _dragVX    = 0;

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

    const el   = dragEl;   dragEl   = null;
    const from = dragFrom; dragFrom = null;

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
            if (!wasAnimating) { renderBoard(); applyMove(fromRow, fromCol, toRow, toCol); }
            else                { renderBoard(); }
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

    const droppedOnOrigin = target && target[0] === from[0] && target[1] === from[1];
    if (droppedOnOrigin) {
        el.style.transition = "opacity 0.1s";
        el.style.opacity    = "0";
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 110);
        renderBoard();
        return;
    }

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
    const frag = document.createDocumentFragment();

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

            const isTarget = highlights.some(([r, c]) => r === row && c === col);
            if (selected && selected[0] === row && selected[1] === col) {
                sq.style.background = "rgba(255,255,0,0.4)";
            } else if (isTarget && boardState[row][col]) {
                sq.style.background = "rgba(255,0,0,0.35)";
            } else {
                sq.style.background = "transparent";
            }

            if (isTarget && !boardState[row][col]) {
                const dot = document.createElement("div");
                dot.className = "move-dot";
                sq.appendChild(dot);
            }

            const piece = boardState[row][col];
            if (piece) {
                const img = document.createElement("img");
                img.src           = `../../pieces/${pieceFolder}/${piece}.png`;
                img.className     = "piece";
                img.draggable     = false;
                img.decoding      = "async";
                img.fetchPriority = "high";

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

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
}

// ─── Click to move ─────────────────────────────────────────────────────────────

function handleClick(row, col) {
    if (moveStyle === "drag") return;
    if (didDrag) { didDrag = false; return; }
    if (gameOver) return;
    if (viewIdx !== -1) { exitHistory(); return; }
    if (_botActive && turn !== _playerCol) return;

    const piece = boardState[row][col];

    if (selected && highlights.some(([r, c]) => r === row && c === col)) {
        if (_animating) return;
        _animating = true;
        const fromRow = selected[0], fromCol = selected[1];
        selected   = null;
        highlights = [];
        renderBoard();
        animateGameMove(fromRow, fromCol, row, col, () => {
            applyMove(fromRow, fromCol, row, col);
            _animating = false;
        });
        return;
    }

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

window.loadGameState();
renderBoard();

window.addEventListener('load', () => {
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

    if (!gameOver && typeof inCheck === 'function' && inCheck(boardState, turn)) {
        const kingPos = findKing(boardState, turn);
        if (kingPos) {
            const kingSq = boardEl.querySelector(`[data-row="${kingPos[0]}"][data-col="${kingPos[1]}"]`);
            if (kingSq) enterCheck(kingSq);
        }
    }

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

window.applyMove   = applyMove;
window.renderBoard = renderBoard;
