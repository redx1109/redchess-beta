/* ══════════════════════════════════════════════════════════════
   RED CHESS — EXPLORE MODE (always on, click + drag & drop)
   Load this AFTER board.js
   ══════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────
let exploreChess      = null;
let selectedSq        = null;
let exploreLegalMoves = [];

// ─── Drag state ───────────────────────────────────────────────
let dragPiece    = null;   // the floating ghost element
let dragFromSq   = null;   // square dragging started from
let dragImg      = null;   // original piece img (hidden while dragging)

// ─── Init ─────────────────────────────────────────────────────
function initExploreMode() {
    if (!boardEl._exploreListenerAttached) {
        // ── Click (delegated) ──────────────────────────────────
        // Use capture phase so we catch it before any piece img handler
        boardEl.addEventListener("click", (e) => {
            // Ignore clicks that were the end of a drag
            if (dragJustFinished) { dragJustFinished = false; return; }
            const sqEl = e.target.closest("[data-sq]");
            if (sqEl) onExploreSquareClick(sqEl);
        }, true);

        // ── Drag (pointer events on board, capture phase) ──────
        boardEl.addEventListener("pointerdown", onDragStart, true);
        window.addEventListener("pointermove",  onDragMove);
        window.addEventListener("pointerup",    onDragEnd);

        boardEl._exploreListenerAttached = true;
    }
    enterExploreMode();
}

// ─── Enter / reset to current game position ───────────────────
function enterExploreMode() {
    if (!positions?.length || positions[currentIdx] == null) return;

    selectedSq        = null;
    exploreLegalMoves = [];

    exploreChess  = new Chess(positions[currentIdx].fen);
    explorePrevCp = analysisData?.[currentIdx]?.cp ?? 0;

    showExploreBanner("Explore mode — click or drag a piece");
    renderExplorePosition();
}

// ─── Banner ───────────────────────────────────────────────────
function showExploreBanner(text) {
    let bar = document.getElementById("exploreBar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "exploreBar";
        bar.style.cssText = `
            text-align:center;font-family:'Cinzel',serif;
            font-size:11px;letter-spacing:0.12em;
            color:#c9a84c;padding:5px 0 2px;opacity:0.8;
        `;
        document.querySelector(".board-col")?.appendChild(bar);
    }
    bar.textContent   = text;
    bar.style.display = "block";
}

// ─── Render ───────────────────────────────────────────────────
function renderExplorePosition() {
    if (!exploreChess) return;
    const hist  = exploreChess.history({ verbose: true });
    const last  = hist[hist.length - 1];
    renderPosition(exploreChess.fen(), last ? [last.from, last.to] : [], []);
    refreshExploreHighlights();
}

// ══════════════════════════════════════════════════════════════
//  CLICK LOGIC
// ══════════════════════════════════════════════════════════════
function onExploreSquareClick(sqEl) {
    if (!exploreChess) return;
    const sq = sqEl.dataset.sq;
    if (!sq) return;

    // Second click — try to move
    if (selectedSq) {
        if (exploreLegalMoves.includes(sq)) { tryExploreMove(selectedSq, sq); return; }
        if (sq === selectedSq)              { clearSelection(); return; }
    }

    // First click — select piece
    const piece = exploreChess.get(sq);
    if (!piece || piece.color !== exploreChess.turn()) { clearSelection(); return; }

    selectedSq        = sq;
    exploreLegalMoves = exploreChess.moves({ square: sq, verbose: true }).map(m => m.to);
    refreshExploreHighlights();
}

function clearSelection() {
    selectedSq        = null;
    exploreLegalMoves = [];
    refreshExploreHighlights();
}

// ══════════════════════════════════════════════════════════════
//  DRAG LOGIC  (pointer events — works on touch + mouse)
// ══════════════════════════════════════════════════════════════
let dragJustFinished = false;

function getSqElFromPoint(x, y) {
    // Temporarily hide ghost so elementFromPoint sees the board underneath
    if (dragPiece) dragPiece.style.display = "none";
    const el = document.elementFromPoint(x, y);
    if (dragPiece) dragPiece.style.display = "";
    return el?.closest("[data-sq]") ?? null;
}

function onDragStart(e) {
    if (!exploreChess) return;

    const sqEl = e.target.closest("[data-sq]");
    if (!sqEl) return;

    const sq    = sqEl.dataset.sq;
    const piece = exploreChess.get(sq);
    if (!piece || piece.color !== exploreChess.turn()) return;

    // Find the piece image inside the square
    dragImg   = sqEl.querySelector("img");
    dragFromSq = sq;

    // Legal moves for this piece (also shows dots)
    selectedSq        = sq;
    exploreLegalMoves = exploreChess.moves({ square: sq, verbose: true }).map(m => m.to);
    refreshExploreHighlights();

    // Build a ghost that follows the pointer
    if (dragImg) {
        dragPiece = dragImg.cloneNode();
        const rect = dragImg.getBoundingClientRect();
        dragPiece.style.cssText = `
            position:fixed;pointer-events:none;z-index:9999;
            width:${rect.width}px;height:${rect.height}px;
            left:${e.clientX - rect.width  / 2}px;
            top :${e.clientY - rect.height / 2}px;
            opacity:0.85;transition:none;
        `;
        document.body.appendChild(dragPiece);
        dragImg.style.opacity = "0.25";
    }

    boardEl.setPointerCapture?.(e.pointerId);
    e.preventDefault();
}

function onDragMove(e) {
    if (!dragPiece || !dragFromSq) return;
    const rect = dragPiece.getBoundingClientRect();
    dragPiece.style.left = `${e.clientX - rect.width  / 2}px`;
    dragPiece.style.top  = `${e.clientY - rect.height / 2}px`;

    // Highlight the square under the cursor
    const hovSqEl = getSqElFromPoint(e.clientX, e.clientY);
    boardEl.querySelectorAll(".explore-drag-over").forEach(el => el.classList.remove("explore-drag-over"));
    if (hovSqEl?.dataset.sq) hovSqEl.classList.add("explore-drag-over");
}

function onDragEnd(e) {
    if (!dragFromSq) return;

    // Clean up ghost
    if (dragPiece) { dragPiece.remove(); dragPiece = null; }
    if (dragImg)   { dragImg.style.opacity = ""; dragImg = null; }
    boardEl.querySelectorAll(".explore-drag-over").forEach(el => el.classList.remove("explore-drag-over"));

    const toSqEl = getSqElFromPoint(e.clientX, e.clientY);
    const toSq   = toSqEl?.dataset.sq;

    if (toSq && exploreLegalMoves.includes(toSq)) {
        dragJustFinished = true;   // suppress the click that fires after pointerup
        tryExploreMove(dragFromSq, toSq);
    } else {
        clearSelection();
    }

    dragFromSq = null;
}

// ══════════════════════════════════════════════════════════════
//  MAKE A MOVE
// ══════════════════════════════════════════════════════════════
function tryExploreMove(from, to) {
    const result = exploreChess.move({ from, to, promotion: "q" });
    if (!result) return false;

    clearSelection();
    playSound(result.captured ? "capture" : "move");

    const fen       = exploreChess.fen();
    const isWhite   = result.color === "w";
    const whiteTurn = exploreChess.turn() === "w";

    startLiveEval(fen, whiteTurn);
    classifyExploreMove(result, isWhite);
    renderExplorePosition();

    const inCheckmate = exploreChess.isCheckmate?.() ?? exploreChess.in_checkmate?.() ?? false;
    const inDraw      = exploreChess.isDraw?.()      ?? exploreChess.in_draw?.()      ?? false;
    const inCheck     = exploreChess.inCheck?.()     ?? exploreChess.in_check?.()     ?? false;

    if      (inCheckmate) showExploreBanner("Checkmate! ♚");
    else if (inDraw)      showExploreBanner("Draw!");
    else if (inCheck)     showExploreBanner("Check!");
    else                  showExploreBanner("Explore mode — click or drag a piece");

    return true;
}

// ─── Highlights: selected sq + legal move dots + drag hover ──
function refreshExploreHighlights() {
    boardEl.querySelectorAll("[data-sq]").forEach(sqEl => {
        const sq = sqEl.dataset.sq;
        sqEl.classList.remove("explore-selected");
        sqEl.querySelectorAll(".explore-legal-dot").forEach(d => d.remove());

        if (sq === selectedSq) sqEl.classList.add("explore-selected");

        if (exploreLegalMoves.includes(sq)) {
            const dot     = document.createElement("div");
            dot.className = "explore-legal-dot";
            const hasPiece = !!exploreChess?.get(sq);
            dot.style.cssText = hasPiece
                ? `position:absolute;inset:0;border-radius:50%;border:3px solid rgba(201,168,76,0.6);pointer-events:none;z-index:5;`
                : `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30%;height:30%;border-radius:50%;background:rgba(201,168,76,0.5);pointer-events:none;z-index:5;`;
            sqEl.style.position = "relative";
            sqEl.appendChild(dot);
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  LIVE EVAL
// ══════════════════════════════════════════════════════════════
let exploreLiveToken = 0;

function startLiveEval(fen, whiteTurn) {
    if (!stockfish || !sfReady) return;
    const myToken    = ++exploreLiveToken;
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

        const d  = parseInt((msg.match(/\bdepth (\d+)/) || [])[1]);
        const cp = (msg.match(/score cp (-?\d+)/)        || [])[1];
        const mt = (msg.match(/score mate (-?\d+)/)      || [])[1];
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

// ══════════════════════════════════════════════════════════════
//  CLASSIFY + FEEDBACK
// ══════════════════════════════════════════════════════════════
let explorePrevCp = 0;

function classifyExploreMove(moveResult, isWhite) {
    const fen       = exploreChess.fen();
    const myToken   = exploreLiveToken;
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

            const playerRating = isWhite ? whiteRating : blackRating;
            const cls = classifyMove(
                cpBeforeWP, cpAfterWP, isWhite,
                0, moveResult.from + moveResult.to, null,
                moveResult, fen, null, playerRating
            );
            const acc = moveAccuracy(cpBeforeWP, cpAfterWP, isWhite, cls, playerRating);
            showExploreFeedback(cls, acc, cpAfterWP, moveResult.san);
        }
    };
    stockfish.addEventListener("message", handler);
}

function showExploreFeedback(cls, acc, cpWP, san) {
    const panel = document.getElementById("moveDetail");
    if (!panel) return;
    panel.style.display = "flex";

    const iconEl = document.getElementById("detailIcon");
    const clsEl  = document.getElementById("detailClass");
    const evalEl = document.getElementById("detailEval");
    const bestEl = document.getElementById("detailBest");

    if (iconEl) {
        const validIcons = new Set([
            "brilliant","great","best","good","book",
            "inaccuracy","mistake","blunder","miss","forced"
        ]);
        const iconFallback = { theoryend: "book" };
        const iconName     = validIcons.has(cls) ? cls : (iconFallback[cls] ?? "good");
        const newSrc       = `../icons/${iconName}.png`;
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

// ══════════════════════════════════════════════════════════════
//  HOOK INTO NAVIGATION  (stepping through game resets explore)
// ══════════════════════════════════════════════════════════════
const _origGoToMove = window.goToMove;
if (typeof goToMove === "function") {
    window.goToMove = function(idx) {
        _origGoToMove(idx);
        enterExploreMode();
    };
}

const _origShowScreen = window.showScreen;
if (typeof showScreen === "function") {
    window.showScreen = function(id) {
        _origShowScreen(id);
        if (id === "screenAnalysis") initExploreMode();
    };
}

// ─── CSS for drag-hover highlight ────────────────────────────
const exploreStyle = document.createElement("style");
exploreStyle.textContent = `
    .explore-selected { outline: 2px solid rgba(201,168,76,0.85) !important; }
    .explore-drag-over { background: rgba(201,168,76,0.25) !important; }
    [data-sq] { user-select: none; -webkit-user-select: none; }
    [data-sq] img { pointer-events: none; user-select: none; draggable: false; }
`;
document.head.appendChild(exploreStyle);
