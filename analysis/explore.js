/* ══════════════════════════════════════════════════════════════
   RED CHESS — EXPLORE MODE
   Drop this as explore.js and load it AFTER board.js in HTML
   ══════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────
let exploreMode   = false;
let exploreChess  = null;   // chess.js instance for explore line
let selectedSq    = null;   // currently selected square
let exploreLegalMoves = []; // legal moves from selected square

// ─── Toggle button (injected into nav-strip) ──────────────────
function initExploreButton() {
    const strip = document.querySelector(".nav-strip");
    if (!strip || document.getElementById("exploreBtn")) return;

    const btn = document.createElement("button");
    btn.id          = "exploreBtn";
    btn.className   = "nav-btn";
    btn.title       = "Explore moves";
    btn.textContent = "⊕ Explore";
    btn.style.cssText = "padding: 0 10px; font-size: 11px; opacity: 0.6;";
    btn.onclick = toggleExploreMode;
    strip.appendChild(btn);
}

// ─── Enter / Exit ─────────────────────────────────────────────
function toggleExploreMode() {
    if (exploreMode) exitExploreMode();
    else             enterExploreMode();
}

function enterExploreMode() {
    exploreMode  = true;
    selectedSq   = null;
    exploreLegalMoves = [];

    // Spin up chess.js from current position
    const pos = positions[currentIdx];
    exploreChess = new Chess(pos.fen);

    // Update button
    const btn = document.getElementById("exploreBtn");
    if (btn) {
        btn.textContent   = "✕ Exit Explore";
        btn.style.opacity = "1";
        btn.style.color   = "#c9a84c";
    }

    // Show hint bar
    showExploreBanner("Explore mode — click a piece to move");

    // Re-render with explore click handlers
    renderExplorePosition();
}

function exitExploreMode() {
    exploreMode  = false;
    selectedSq   = null;
    exploreLegalMoves = [];
    exploreChess = null;

    const btn = document.getElementById("exploreBtn");
    if (btn) {
        btn.textContent   = "⊕ Explore";
        btn.style.opacity = "0.6";
        btn.style.color   = "";
    }

    hideExploreBanner();

    // Restore normal position view
    goToMove(currentIdx);
}

// ─── Banner ───────────────────────────────────────────────────
function showExploreBanner(text) {
    let bar = document.getElementById("exploreBar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "exploreBar";
        bar.style.cssText = `
            text-align: center;
            font-family: 'Cinzel', serif;
            font-size: 11px;
            letter-spacing: 0.12em;
            color: #c9a84c;
            padding: 5px 0 2px;
            opacity: 0.8;
        `;
        const boardCol = document.querySelector(".board-col");
        if (boardCol) boardCol.appendChild(bar);
    }
    bar.textContent = text;
    bar.style.display = "block";
}

function hideExploreBanner() {
    const bar = document.getElementById("exploreBar");
    if (bar) bar.style.display = "none";
}

// ─── Render explore position with clickable squares ───────────
function renderExplorePosition() {
    if (!exploreChess) return;
    const fen = exploreChess.fen();

    // Highlight last move if any
    const hist = exploreChess.history({ verbose: true });
    const last = hist[hist.length - 1];
    const hlSqs = last ? [last.from, last.to] : [];

    // Render board normally first
    renderPosition(fen, hlSqs, []);

    // Attach click handlers to every square
    boardEl.querySelectorAll(".square").forEach(sqEl => {
        sqEl.style.cursor = "pointer";
        sqEl.addEventListener("click", onExploreSquareClick);
    });

    // Re-highlight selected square + legal move dots
    refreshExploreHighlights();
}

// ─── Click handler ────────────────────────────────────────────
function onExploreSquareClick(e) {
    if (!exploreMode || !exploreChess) return;
    const sq = e.currentTarget.dataset.sq;
    if (!sq) return;

    // If a square is already selected — try to move there
    if (selectedSq) {
        const moved = tryExploreMove(selectedSq, sq);
        if (moved) return;

        // Clicked same square → deselect
        if (sq === selectedSq) {
            selectedSq = null;
            exploreLegalMoves = [];
            refreshExploreHighlights();
            return;
        }
    }

    // Select a new piece
    const piece = exploreChess.get(sq);
    if (!piece) { selectedSq = null; exploreLegalMoves = []; refreshExploreHighlights(); return; }

    // Only allow moving the side to move
    const turn = exploreChess.turn(); // 'w' or 'b'
    if (piece.color !== turn) { selectedSq = null; exploreLegalMoves = []; refreshExploreHighlights(); return; }

    selectedSq = sq;
    exploreLegalMoves = exploreChess.moves({ square: sq, verbose: true }).map(m => m.to);
    refreshExploreHighlights();
}

// ─── Try making a move ────────────────────────────────────────
function tryExploreMove(from, to) {
    // Handle promotion — always promote to queen for simplicity
    const result = exploreChess.move({ from, to, promotion: "q" });
    if (!result) return false;

    selectedSq = null;
    exploreLegalMoves = [];

    // Sound
    playSound(result.captured ? "capture" : "move");

    // Live eval + move feedback
    const fen        = exploreChess.fen();
    const isWhite    = result.color === "w";
    const whiteTurn  = exploreChess.turn() === "w"; // whose turn AFTER the move

    // Kick off live eval search
    startLiveEval(fen, whiteTurn);

    // Classify the move (compare prev position eval to new)
    classifyExploreMove(result, isWhite);

    // Re-render board with new position
    renderExplorePosition();

    // Update banner
    if (exploreChess.isCheckmate()) {
        showExploreBanner("Checkmate!");
    } else if (exploreChess.isDraw()) {
        showExploreBanner("Draw!");
    } else if (exploreChess.inCheck()) {
        showExploreBanner("Check!");
    } else {
        showExploreBanner("Explore mode — click a piece to move");
    }

    return true;
}

// ─── Highlight selected sq + legal move dots ──────────────────
function refreshExploreHighlights() {
    boardEl.querySelectorAll(".square").forEach(sqEl => {
        const sq = sqEl.dataset.sq;
        sqEl.classList.remove("explore-selected", "explore-dot");

        // Remove existing dot overlays
        sqEl.querySelectorAll(".explore-legal-dot").forEach(d => d.remove());

        if (sq === selectedSq) {
            sqEl.classList.add("explore-selected");
        }

        if (exploreLegalMoves.includes(sq)) {
            // Dot overlay
            const dot = document.createElement("div");
            dot.className = "explore-legal-dot";
            const hasPiece = !!exploreChess.get(sq);
            dot.style.cssText = hasPiece
                ? `position:absolute;inset:0;border-radius:50%;border:3px solid rgba(201,168,76,0.55);pointer-events:none;z-index:5;`
                : `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:28%;height:28%;border-radius:50%;background:rgba(201,168,76,0.45);pointer-events:none;z-index:5;`;
            sqEl.style.position = "relative";
            sqEl.appendChild(dot);
        }
    });
}

// ─── Live eval during explore ─────────────────────────────────
let exploreLiveToken = 0;

function startLiveEval(fen, whiteTurn) {
    if (!stockfish || !sfReady) return;
    const myToken = ++exploreLiveToken;

    stockfish.postMessage("stop");
    stockfish.postMessage("position fen " + fen);
    stockfish.postMessage("go depth 20");

    const handler = (e) => {
        if (myToken !== exploreLiveToken) { stockfish.removeEventListener("message", handler); return; }
        const msg = e.data;
        if (typeof msg !== "string") return;

        if (msg.startsWith("bestmove")) {
            stockfish.removeEventListener("message", handler);
            return;
        }
        if (!msg.startsWith("info") || !msg.includes("score")) return;

        const d  = parseInt((msg.match(/\bdepth (\d+)/)     || [])[1]);
        const cp = (msg.match(/score cp (-?\d+)/)            || [])[1];
        const mt = (msg.match(/score mate (-?\d+)/)          || [])[1];
        if (isNaN(d)) return;

        updateEvalBar(
            cp !== undefined ? +cp   : null,
            mt !== undefined ? +mt   : null,
            whiteTurn
        );

        const el = document.getElementById("evalDepth");
        if (el) el.textContent = `Depth: ${d}`;
    };

    stockfish.addEventListener("message", handler);
}

// ─── Classify explore move ────────────────────────────────────
let explorePrevCp = 0;  // track cp before each move

function classifyExploreMove(moveResult, isWhite) {
    // We don't have the engine result yet (it's async),
    // so we show feedback once bestmove arrives
    const fen = exploreChess.fen();
    const myToken = exploreLiveToken;

    let bestCpAfter = null;

    const handler = (e) => {
        if (myToken !== exploreLiveToken) { stockfish.removeEventListener("message", handler); return; }
        const msg = e.data;
        if (typeof msg !== "string") return;

        if (msg.includes("score cp")) {
            const cp = (msg.match(/score cp (-?\d+)/) || [])[1];
            if (cp !== undefined) bestCpAfter = +cp;
        }

        if (msg.startsWith("bestmove")) {
            stockfish.removeEventListener("message", handler);

            const cpAfterWP  = fen.split(" ")[1] === "b" ? -(bestCpAfter ?? 0) : (bestCpAfter ?? 0);
            const cpBeforeWP = explorePrevCp;

            // Update prev for next move
            explorePrevCp = cpAfterWP;

            const played = moveResult.from + moveResult.to;
            const playerRating = isWhite ? whiteRating : blackRating;

            const cls = classifyMove(
                cpBeforeWP,
                cpAfterWP,
                isWhite,
                0,
                played,
                null,
                moveResult,
                fen,
                null,
                playerRating
            );

            const acc = moveAccuracy(cpBeforeWP, cpAfterWP, isWhite, cls, playerRating);

            // Show feedback in the detail panel
            showExploreFeedback(cls, acc, cpAfterWP, moveResult.san);
        }
    };

    stockfish.addEventListener("message", handler);
}

// ─── Show move feedback in detail panel ──────────────────────
function showExploreFeedback(cls, acc, cpWP, san) {
    const panel = document.getElementById("moveDetail");
    if (!panel) return;
    panel.style.display = "flex";

    const iconEl  = document.getElementById("detailIcon");
    const clsEl   = document.getElementById("detailClass");
    const evalEl  = document.getElementById("detailEval");
    const bestEl  = document.getElementById("detailBest");

    if (iconEl) iconEl.src = `../icons/${cls}.png`;
    if (clsEl)  clsEl.textContent  = cls.charAt(0).toUpperCase() + cls.slice(1);
    if (evalEl) evalEl.textContent = (cpWP > 0 ? "+" : "") + (cpWP / 100).toFixed(1);
    if (bestEl) bestEl.textContent = san;
}

// ─── Init on DOM ready ────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initExploreButton();
});

// Also init when board screen becomes visible (in case DOMContentLoaded already fired)
const _origShowScreen = window.showScreen;
if (typeof showScreen === "function") {
    window.showScreen = function(id) {
        showScreen(id);
        if (id === "screenAnalysis") initExploreButton();
    };
}
