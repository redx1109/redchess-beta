/* ══════════════════════════════════════════════════════════════
   RED CHESS — EXPLORE MODE (always on, click + drag & drop)
   Load this AFTER board.js
   ══════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────
let exploreChess      = null;
let selectedSq        = null;
let exploreLegalMoves = [];
let explorePrevCp     = 0;
let exploreLiveToken  = 0;

// ─── Drag state ───────────────────────────────────────────────
let dragPiece        = null;
let dragFromSq       = null;
let dragImg          = null;
let dragJustFinished = false;

// ══════════════════════════════════════════════════════════════
//  ENTER — spin up exploreChess from current position
// ══════════════════════════════════════════════════════════════
function enterExploreMode() {
    if (!positions?.length || positions[currentIdx] == null) return;

    selectedSq        = null;
    exploreLegalMoves = [];
    exploreChess      = new Chess(positions[currentIdx].fen);
    explorePrevCp     = analysisData?.[currentIdx]?.cp ?? 0;

    showExploreBanner("Explore — click or drag a piece");
    // Don't re-render: board.js already rendered the position.
    // Just refresh any dots/selection overlays.
    refreshExploreHighlights();
}

// ══════════════════════════════════════════════════════════════
//  ATTACH LISTENERS — once, after DOM is ready
// ══════════════════════════════════════════════════════════════
function attachExploreListeners() {
    const b = document.getElementById("board");
    if (!b || b._exploreListenerAttached) return;

    // capture phase so piece <img> never swallows the event
    b.addEventListener("click", (e) => {
        if (dragJustFinished) { dragJustFinished = false; return; }
        const sqEl = e.target.closest("[data-sq]");
        if (sqEl) onExploreSquareClick(sqEl);
    }, true);

    b.addEventListener("pointerdown", onDragStart, true);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup",   onDragEnd);

    b._exploreListenerAttached = true;
}

// ══════════════════════════════════════════════════════════════
//  HOOK goToMove — enterExploreMode after every navigation
//  We wait until window.onload so all scripts (events.js etc.)
//  have had a chance to define / overwrite goToMove first.
// ══════════════════════════════════════════════════════════════
window.addEventListener("load", () => {
    attachExploreListeners();

    const _orig = window.goToMove;
    window.goToMove = function(idx) {
        _orig(idx);
        // finalize() inside goToMove is sync when no animation,
        // but async (150 ms) when animating. Wait a tick to be safe.
        setTimeout(enterExploreMode, 160);
    };

    // Kick off for the initial position if the board is already visible
    setTimeout(enterExploreMode, 200);
});

// ══════════════════════════════════════════════════════════════
//  BANNER
// ══════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════
//  CLICK
// ══════════════════════════════════════════════════════════════
function onExploreSquareClick(sqEl) {
    if (!exploreChess) return;
    const sq = sqEl.dataset.sq;
    if (!sq) return;

    if (selectedSq) {
        if (exploreLegalMoves.includes(sq)) { tryExploreMove(selectedSq, sq); return; }
        if (sq === selectedSq)              { clearExploreSelection(); return; }
    }

    const piece = exploreChess.get(sq);
    if (!piece || piece.color !== exploreChess.turn()) { clearExploreSelection(); return; }

    selectedSq        = sq;
    exploreLegalMoves = exploreChess.moves({ square: sq, verbose: true }).map(m => m.to);
    refreshExploreHighlights();
}

function clearExploreSelection() {
    selectedSq        = null;
    exploreLegalMoves = [];
    refreshExploreHighlights();
}

// ══════════════════════════════════════════════════════════════
//  DRAG  (pointer events — mouse + touch)
// ══════════════════════════════════════════════════════════════
function getSqElFromPoint(x, y) {
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

    dragImg    = sqEl.querySelector("img");
    dragFromSq = sq;

    selectedSq        = sq;
    exploreLegalMoves = exploreChess.moves({ square: sq, verbose: true }).map(m => m.to);
    refreshExploreHighlights();

    if (dragImg) {
        const rect = dragImg.getBoundingClientRect();
        dragPiece  = dragImg.cloneNode();
        dragPiece.style.cssText = `
            position:fixed;pointer-events:none;z-index:9999;
            width:${rect.width}px;height:${rect.height}px;
            left:${e.clientX - rect.width  / 2}px;
            top :${e.clientY - rect.height / 2}px;
            opacity:0.9;transition:none;
        `;
        document.body.appendChild(dragPiece);
        dragImg.style.opacity = "0.25";
    }
    e.preventDefault();
}

function onDragMove(e) {
    if (!dragPiece) return;
    const w = parseFloat(dragPiece.style.width);
    const h = parseFloat(dragPiece.style.height);
    dragPiece.style.left = `${e.clientX - w / 2}px`;
    dragPiece.style.top  = `${e.clientY - h / 2}px`;

    const b = document.getElementById("board");
    b?.querySelectorAll(".explore-drag-over").forEach(el => el.classList.remove("explore-drag-over"));
    const hov = getSqElFromPoint(e.clientX, e.clientY);
    if (hov?.dataset.sq) hov.classList.add("explore-drag-over");
}

function onDragEnd(e) {
    if (!dragFromSq) return;

    if (dragPiece) { dragPiece.remove(); dragPiece = null; }
    if (dragImg)   { dragImg.style.opacity = ""; dragImg = null; }
    document.getElementById("board")
        ?.querySelectorAll(".explore-drag-over")
        .forEach(el => el.classList.remove("explore-drag-over"));

    const toSqEl = getSqElFromPoint(e.clientX, e.clientY);
    const toSq   = toSqEl?.dataset.sq;

    if (toSq && exploreLegalMoves.includes(toSq)) {
        dragJustFinished = true;
        tryExploreMove(dragFromSq, toSq);
    } else {
        clearExploreSelection();
    }

    dragFromSq = null;
}

// ══════════════════════════════════════════════════════════════
//  MAKE A MOVE
// ══════════════════════════════════════════════════════════════
function tryExploreMove(from, to) {
    const result = exploreChess.move({ from, to, promotion: "q" });
    if (!result) return false;

    clearExploreSelection();
    playSound(result.captured ? "capture" : "move");

    const fen       = exploreChess.fen();
    const isWhite   = result.color === "w";
    const whiteTurn = exploreChess.turn() === "w";

    // Re-render board to new position (reuses board.js renderPosition)
    const hist = exploreChess.history({ verbose: true });
    const last  = hist[hist.length - 1];
    renderPosition(fen, last ? [last.from, last.to] : [], []);
    refreshExploreHighlights();

    startLiveEval(fen, whiteTurn);
    classifyExploreMove(result, isWhite);

    const inCheckmate = exploreChess.isCheckmate?.() ?? exploreChess.in_checkmate?.() ?? false;
    const inDraw      = exploreChess.isDraw?.()      ?? exploreChess.in_draw?.()      ?? false;
    const inCheck     = exploreChess.inCheck?.()     ?? exploreChess.in_check?.()     ?? false;

    if      (inCheckmate) showExploreBanner("Checkmate! ♚");
    else if (inDraw)      showExploreBanner("Draw!");
    else if (inCheck)     showExploreBanner("Check!");
    else                  showExploreBanner("Explore — click or drag a piece");

    return true;
}

// ══════════════════════════════════════════════════════════════
//  HIGHLIGHTS  (dots + selected square)
// ══════════════════════════════════════════════════════════════
function refreshExploreHighlights() {
    const b = document.getElementById("board");
    if (!b) return;

    b.querySelectorAll("[data-sq]").forEach(sqEl => {
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

    const validIcons = new Set([
        "brilliant","great","best","good","book",
        "inaccuracy","mistake","blunder","miss","forced"
    ]);
    const iconName = validIcons.has(cls) ? cls : "good";

    const iconEl = document.getElementById("detailIcon");
    const clsEl  = document.getElementById("detailClass");
    const evalEl = document.getElementById("detailEval");
    const bestEl = document.getElementById("detailBest");

    if (iconEl) {
        const newSrc = `../icons/${iconName}.png`;
        if (iconEl.getAttribute("src") === newSrc) {
            iconEl.removeAttribute("src");
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
//  CSS  (injected so no stylesheet changes needed)
// ══════════════════════════════════════════════════════════════
const _exploreStyle = document.createElement("style");
_exploreStyle.textContent = `
    .explore-selected { outline: 2px solid rgba(201,168,76,0.9) !important; z-index: 2; }
    .explore-drag-over { background: rgba(201,168,76,0.28) !important; }
    #board [data-sq] { user-select:none; -webkit-user-select:none; }
    #board [data-sq] img { pointer-events:none !important; user-select:none; }
`;
document.head.appendChild(_exploreStyle);
