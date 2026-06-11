/* ══════════════════════════════════════════════════════════════
   RED CHESS — EXPLORE MODE (always on, no toggle button)
   Drop this as explore.js and load it AFTER board.js in HTML
   ══════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────
let exploreChess      = null;   // chess.js instance for explore line
let selectedSq        = null;   // currently selected square
let exploreLegalMoves = [];     // legal moves from selected square

// ─── Init (called whenever analysis screen becomes visible) ───
function initExploreMode() {
    // Delegated listener — attach once, survive innerHTML wipes
    if (!boardEl._exploreListenerAttached) {
        boardEl.addEventListener("click", (e) => {
            const sqEl = e.target.closest(".square");
            if (sqEl) onExploreSquareClick(sqEl);
        });
        boardEl._exploreListenerAttached = true;
    }
    enterExploreMode();
}

// ─── Enter ────────────────────────────────────────────────────
function enterExploreMode() {
    if (!positions || !positions.length || positions[currentIdx] == null) return;

    selectedSq        = null;
    exploreLegalMoves = [];

    const pos     = positions[currentIdx];
    exploreChess  = new Chess(pos.fen);
    explorePrevCp = analysisData?.[currentIdx]?.cp ?? 0;

    showExploreBanner("Explore mode — click a piece to move");
    renderExplorePosition();
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
    bar.textContent   = text;
    bar.style.display = "block";
}

// ─── Render explore position with clickable squares ───────────
function renderExplorePosition() {
    if (!exploreChess) return;
    const hist  = exploreChess.history({ verbose: true });
    const last  = hist[hist.length - 1];
    const hlSqs = last ? [last.from, last.to] : [];

    renderPosition(exploreChess.fen(), hlSqs, []);
    refreshExploreHighlights();
}

// ─── Click handler ────────────────────────────────────────────
function onExploreSquareClick(sqEl) {
    if (!exploreChess) return;
    const sq = sqEl.dataset.sq;
    if (!sq) return;

    if (selectedSq) {
        if (exploreLegalMoves.includes(sq)) {
            tryExploreMove(selectedSq, sq);
            return;
        }
        if (sq === selectedSq) {
            selectedSq        = null;
            exploreLegalMoves = [];
            refreshExploreHighlights();
            return;
        }
    }

    const piece = exploreChess.get(sq);
    if (!piece || piece.color !== exploreChess.turn()) {
        selectedSq        = null;
        exploreLegalMoves = [];
        refreshExploreHighlights();
        return;
    }

    selectedSq        = sq;
    exploreLegalMoves = exploreChess.moves({ square: sq, verbose: true }).map(m => m.to);
    refreshExploreHighlights();
}

// ─── Try making a move ────────────────────────────────────────
function tryExploreMove(from, to) {
    const result = exploreChess.move({ from, to, promotion: "q" });
    if (!result) return false;

    selectedSq        = null;
    exploreLegalMoves = [];

    playSound(result.captured ? "capture" : "move");

    const fen       = exploreChess.fen();
    const isWhite   = result.color === "w";
    const whiteTurn = exploreChess.turn() === "w";

    startLiveEval(fen, whiteTurn);
    classifyExploreMove(result, isWhite);
    renderExplorePosition();

    // Support both chess.js v0.x and v1.x APIs
    const inCheckmate = exploreChess.isCheckmate?.() ?? exploreChess.in_checkmate?.() ?? false;
    const inDraw      = exploreChess.isDraw?.()      ?? exploreChess.in_draw?.()      ?? false;
    const inCheck     = exploreChess.inCheck?.()     ?? exploreChess.in_check?.()     ?? false;

    if (inCheckmate)  showExploreBanner("Checkmate!");
    else if (inDraw)  showExploreBanner("Draw!");
    else if (inCheck) showExploreBanner("Check!");
    else              showExploreBanner("Explore mode — click a piece to move");

    return true;
}

// ─── Highlight selected sq + legal move dots ──────────────────
function refreshExploreHighlights() {
    boardEl.querySelectorAll(".square").forEach(sqEl => {
        const sq = sqEl.dataset.sq;
        sqEl.classList.remove("explore-selected", "explore-dot");
        sqEl.querySelectorAll(".explore-legal-dot").forEach(d => d.remove());

        if (sq === selectedSq) sqEl.classList.add("explore-selected");

        if (exploreLegalMoves.includes(sq)) {
            const dot      = document.createElement("div");
            dot.className  = "explore-legal-dot";
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
    const myToken   = ++exploreLiveToken;
    const sideToMove = fen.split(" ")[1];

    stockfish.postMessage("stop");
    stockfish.postMessage("position fen " + fen);
    stockfish.postMessage("go depth 20");

    const handler = (e) => {
        if (myToken !== exploreLiveToken) { stockfish.removeEventListener("message", handler); return; }
        const msg = e.data;
        if (typeof msg !== "string") return;

        if (msg.startsWith("bestmove")) { stockfish.removeEventListener("message", handler); return; }
        if (!msg.startsWith("info") || !msg.includes("score")) return;

        const d  = parseInt((msg.match(/\bdepth (\d+)/)  || [])[1]);
        const cp = (msg.match(/score cp (-?\d+)/)         || [])[1];
        const mt = (msg.match(/score mate (-?\d+)/)       || [])[1];
        if (isNaN(d)) return;

        let liveCp   = cp !== undefined ? +cp : null;
        let liveMate = mt !== undefined ? +mt : null;
        if (sideToMove === "b") {
            if (liveCp   !== null) liveCp   = -liveCp;
            if (liveMate !== null) liveMate = -liveMate;
        }

        updateEvalBar(liveCp, liveMate, true);

        const el = document.getElementById("evalDepth");
        if (el) el.textContent = `Depth: ${d}`;
    };

    stockfish.addEventListener("message", handler);
}

// ─── Classify explore move ────────────────────────────────────
let explorePrevCp = 0;

function classifyExploreMove(moveResult, isWhite) {
    const fen     = exploreChess.fen();
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
            explorePrevCp    = cpAfterWP;

            const played       = moveResult.from + moveResult.to;
            const playerRating = isWhite ? whiteRating : blackRating;

            const cls = classifyMove(
                cpBeforeWP, cpAfterWP, isWhite,
                0, played, null, moveResult, fen, null, playerRating
            );

            const acc = moveAccuracy(cpBeforeWP, cpAfterWP, isWhite, cls, playerRating);
            showExploreFeedback(cls, acc, cpAfterWP, moveResult.san);
        }
    };

    stockfish.addEventListener("message", handler);
}

// ─── Show move classification in detail panel ─────────────────
// Forces the panel visible and ensures the icon src updates properly
function showExploreFeedback(cls, acc, cpWP, san) {
    const panel = document.getElementById("moveDetail");
    if (!panel) return;

    // Make the panel visible (it may be hidden between moves)
    panel.style.display = "flex";

    const iconEl = document.getElementById("detailIcon");
    const clsEl  = document.getElementById("detailClass");
    const evalEl = document.getElementById("detailEval");
    const bestEl = document.getElementById("detailBest");

    if (iconEl) {
        // Valid icon filenames that actually exist in /icons/
        const validIcons = new Set([
            "brilliant", "great", "best", "good", "book",
            "inaccuracy", "mistake", "blunder", "miss", "forced"
        ]);
        const iconFallback = { theoryend: "book" };
        const iconName     = validIcons.has(cls) ? cls : (iconFallback[cls] ?? "good");
        const newSrc       = `../icons/${iconName}.png`;

        // Force reload if src hasn't changed (same cls twice in a row)
        if (iconEl.src.endsWith(newSrc)) {
            iconEl.src = "";
            requestAnimationFrame(() => { iconEl.src = newSrc; });
        } else {
            iconEl.src = newSrc;
        }
        iconEl.alt = cls;
    }

    if (clsEl)  clsEl.textContent  = cls.charAt(0).toUpperCase() + cls.slice(1);
    if (evalEl) evalEl.textContent = (cpWP > 0 ? "+" : "") + (cpWP / 100).toFixed(1);
    if (bestEl) bestEl.textContent = san;
}

// ─── Hook into navigation: re-enter explore on move change ────
// When the user steps through the game, reset explore to that position
const _origGoToMove = window.goToMove;
if (typeof goToMove === "function") {
    window.goToMove = function(idx) {
        _origGoToMove(idx);
        enterExploreMode();
    };
}

// ─── Init when analysis screen becomes visible ────────────────
// Don't call initExploreMode on DOMContentLoaded — positions aren't
// loaded yet at that point. Hook showScreen instead so explore only
// starts once the game data is actually ready.
const _origShowScreen = window.showScreen;
if (typeof showScreen === "function") {
    window.showScreen = function(id) {
        _origShowScreen(id);
        if (id === "screenAnalysis") initExploreMode();
    };
}
