/* ══════════════════════════════════════════════════════════════
   RED CHESS — BOARD  (rendering, move list, navigation)
   ══════════════════════════════════════════════════════════════ */
let liveEvalSearch = 0;   
let boardFlipped = false;
const boardEl = document.getElementById("board");

function buildCoordLabels() {
    const rankLabels = document.getElementById("rankLabels");
    const fileLabels = document.getElementById("fileLabels");
    if (rankLabels) {
        rankLabels.innerHTML = "";
        for (let i = 0; i < 8; i++) {
            const span = document.createElement("span");
            span.textContent = boardFlipped ? (i + 1) : (8 - i);
            rankLabels.appendChild(span);
        }
    }
    if (fileLabels) {
        fileLabels.innerHTML = "";
        const files = boardFlipped ? "hgfedcba" : "abcdefgh";
        for (const f of files) {
            const span = document.createElement("span");
            span.textContent = f;
            fileLabels.appendChild(span);
        }
    }
}

const CLS_COLOR = {
    brilliant:"#1baca6", great:"#5c8a3c", best:"#7FC97A",
    excellent:"#96C964", good:"#A3C86E", book:"#A88650",
    inaccuracy:"#F6C833", mistake:"#F0874A", blunder:"#E44E4E", miss:"#E84D39"
};

function buildMobileStrip() {
    if (window.innerWidth > 700) return;
    let strip = document.getElementById("mobileMovStrip");
    if (!strip) {
        strip = document.createElement("div");
        strip.className = "mobile-move-strip";
        strip.id = "mobileMovStrip";
        const navNext = document.getElementById("navNext");
        navNext.parentNode.insertBefore(strip, navNext);
    }
    strip.innerHTML = "";
    for (let i = 1; i < positions.length; i++) {
        const pos  = positions[i];
        const data = analysisData[i] || {};
        const cls  = data.classification || "best";
        const isW  = pos.color === "w";
        const chip = document.createElement("div");
        chip.className   = "mob-chip";
        chip.dataset.idx = i;
        const num = document.createElement("span");
        num.className   = "mob-chip-num";
        num.textContent = isW ? Math.ceil(i / 2) + "." : "";
        const dot = document.createElement("img");
        dot.src       = CLASS_IMG_PATH + cls + ".png";
        dot.alt       = cls;
        dot.style.cssText = "width:20px;height:20px;object-fit:contain;flex-shrink:0;";
        const label = document.createElement("span");
        label.textContent = pos.san;
        chip.appendChild(num);
        chip.appendChild(dot);
        chip.appendChild(label);
        chip.addEventListener("click", () => goToMove(i));
        strip.appendChild(chip);
    }
}
// ─── Board rendering ──────────────────────────────────────────────────────────

function renderPosition(fen, highlightSqs = [], bestSqs = []) {
    clearClassificationHighlights();
    const chess = new Chess(fen);
    boardEl.innerHTML = "";

    const theme = (JSON.parse(localStorage.getItem("chessSettings") || "{}")).board || "green";
    boardEl.style.backgroundImage = `url('../boards/${theme}.jpg')`;
    boardEl.style.backgroundSize  = "100% 100%";

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const r = boardFlipped ? 7 - row : row;
            const c = boardFlipped ? 7 - col : col;
            const file = String.fromCharCode(97 + c);
            const rank = 8 - r;
            const sq = file + rank;

            const sqEl = document.createElement("div");
            sqEl.className  = "square " + ((row + col) % 2 === 0 ? "light" : "dark");
            sqEl.dataset.sq = sq;
            sqEl.style.position = "relative";

            const overlay = document.createElement("div");
            overlay.className = "sq-highlight-overlay";
            sqEl.appendChild(overlay);

            if (highlightSqs.includes(sq)) sqEl.classList.add("current-move");
            if (bestSqs.includes(sq))      sqEl.classList.add("best-move");

            const piece = chess.get(sq);
            if (piece) {
                const code = (piece.color === "w" ? "w" : "b") + piece.type.toUpperCase();
                const img  = document.createElement("img");
                img.src       = `../pieces/${pieceFolder}/${code}.png`;
                img.className = "piece";
                img.draggable = false;
                sqEl.appendChild(img);
            }

            boardEl.appendChild(sqEl);
            buildCoordLabels();
        }
    }
}

// ─── Move animation ───────────────────────────────────────────────────────────
// Clones the piece on fromSq into a fixed-position ghost, slides it to toSq,
// then calls onDone() so the caller can swap in the new position.

let _animating = false;

function animateMove(fromSq, toSq, onDone) {
    const fromEl = boardEl.querySelector(`[data-sq="${fromSq}"]`);
    const toEl   = boardEl.querySelector(`[data-sq="${toSq}"]`);
    const piece  = fromEl && fromEl.querySelector(".piece");

    if (!piece || !fromEl || !toEl) { onDone(); return; }

    const fromRect = fromEl.getBoundingClientRect();
    const toRect   = toEl.getBoundingClientRect();
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top  - fromRect.top;

    // Ghost piece rides above everything during the slide
    const ghost = piece.cloneNode();
    ghost.style.cssText = `
        position: fixed;
        left: ${fromRect.left}px;
        top:  ${fromRect.top}px;
        width: ${fromRect.width * 0.88}px;
        height: ${fromRect.height * 0.88}px;
        object-fit: contain;
        pointer-events: none;
        z-index: 999;
        transition: transform 0.13s cubic-bezier(.4,0,.2,1);
        filter: drop-shadow(0 4px 10px rgba(0,0,0,.7));
        will-change: transform;
    `;
    piece.style.opacity = "0"; // hide original while ghost travels
    document.body.appendChild(ghost);

    // Force reflow so the browser registers the starting position
    ghost.getBoundingClientRect();
    ghost.style.transform = `translate(${dx}px, ${dy}px)`;

    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        ghost.remove();
        onDone();
    };
    ghost.addEventListener("transitionend", finish, { once: true });
    // Safety net: if transitionend never fires (hidden tab, zero-duration, etc.)
    setTimeout(finish, 250);
}

// ─── Move list ────────────────────────────────────────────────────────────────

function buildMoveList() {
    const list = document.getElementById("moveList");
    list.innerHTML = "";
    let moveNum = 0, currentRow = null;

    for (let i = 1; i < positions.length; i++) {
        const pos  = positions[i];
        const data = analysisData[i] || {};
        const cls  = data.classification || null;
        const isW  = pos.color === "w";

        if (isW) {
            moveNum++;
            currentRow = document.createElement("div");
            currentRow.className = "move-row";
            const numCell = document.createElement("div");
            numCell.className   = "move-num-cell";
            numCell.textContent = moveNum + ".";
            currentRow.appendChild(numCell);
            currentRow.appendChild(makeMoveCell(i, pos.san, cls));
            // placeholder for black
            const ph = document.createElement("div");
            ph.className = "move-cell";
            ph.dataset.placeholder = "true";
            currentRow.appendChild(ph);
            list.appendChild(currentRow);
        } else {
            if (currentRow) {
                const ph = currentRow.querySelector("[data-placeholder]");
                if (ph) {
                    ph.removeAttribute("data-placeholder");
                    ph.dataset.idx = i;
                    if (cls) ph.appendChild(classIcon(cls));
                    const span = document.createElement("span");
                    span.textContent = pos.san;
                    ph.appendChild(span);
                    ph.addEventListener("click", () => goToMove(i));
                }
            }
        }
    }
   buildMobileStrip();
}

function makeMoveCell(idx, san, cls) {
    const el = document.createElement("div");
    el.className   = "move-cell";
    el.dataset.idx = idx;
    if (cls) el.appendChild(classIcon(cls));
    const span = document.createElement("span");
    span.textContent = san;
    el.appendChild(span);
    el.addEventListener("click", () => goToMove(idx));
    return el;
}

function classIcon(cls) {
    return getClassIcon(cls);
}

function updateActiveMoveCell(idx) {
    document.querySelectorAll(".move-cell").forEach(c => c.classList.remove("active"));
    const el = document.querySelector(`.move-cell[data-idx="${idx}"]`);
    if (el) { el.classList.add("active"); el.scrollIntoView({ block: "nearest" }); }

    document.querySelectorAll(".mob-chip").forEach(c => c.classList.remove("active"));
    const chip = document.querySelector(`.mob-chip[data-idx="${idx}"]`);
    if (chip) { chip.classList.add("active"); chip.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }
}
// ─── Navigation ───────────────────────────────────────────────────────────────

function goToMove(idx) {
    if (idx < 0 || idx >= positions.length) return;
    if (_animating) return;

    const prevIdx = currentIdx;
    currentIdx    = idx;

    const pos  = positions[idx];
    const data = analysisData[idx] || {};

    // Highlight squares
    const hlSqs   = [];
    const bestSqs = [];
    if (idx > 0 && pos.move) hlSqs.push(pos.move.from, pos.move.to);
    if (data.bestMove && data.bestMove.length >= 4) {
        bestSqs.push(data.bestMove.slice(0, 2), data.bestMove.slice(2, 4));
    }

    // Animate only when stepping one move at a time (not jumping via move list)
    const isStep  = Math.abs(idx - prevIdx) === 1;
    const canAnim = isStep && idx > 0 && pos.move;

    // ── Everything that runs after the piece lands ──────────────────────────
    const finalize = () => {
        _animating = false;
        renderPosition(pos.fen, hlSqs, bestSqs);

        // Square colour highlight (Chess.com style)
        if (idx > 0 && pos.move) {
            applyClassificationHighlight(pos.move.from, pos.move.to, data.classification || null);
        } else {
            clearClassificationHighlights();
        }

        // Classification icon — floats outside corner, clamped on board edges
        if (idx > 0 && data.classification && pos.move) {
            const sqEl = boardEl.querySelector(`[data-sq="${pos.move.to}"]`);
            if (sqEl) {
                const icon = document.createElement("img");
                icon.src       = CLASS_IMG_PATH + data.classification + ".png";
                icon.className = "sq-class-icon";
                icon.alt       = data.classification;

                const file = pos.move.to.charCodeAt(0) - 97; // 0=a … 7=h
                const rank = parseInt(pos.move.to[1]);        // 1–8

                if (file === 7) { icon.style.right = "auto"; icon.style.left   = "-13px"; }
                if (rank === 8) { icon.style.top   = "auto"; icon.style.bottom = "-13px"; }

                sqEl.appendChild(icon);
            }
        }

        // Arrow layer
        if (typeof drawArrow === "function" && data.bestMove && data.bestMove.length >= 4) {
            drawArrow(data.bestMove.slice(0, 2), data.bestMove.slice(2, 4));
        } else {
            const al = document.getElementById("arrowLayer");
            if (al) al.innerHTML = "";
        }
    };

    // Sound fires immediately (matches Chess.com timing — don't wait for slide)
    if (idx > 0 && pos.move) playSound(pos.move.captured ? "capture" : "move");

    // Eval bar, move list, and detail panel update right away too
    const whiteTurn = idx === 0 ? true : pos.color === "b";
    updateEvalBar(data.cp ?? null, data.mate ?? null, whiteTurn);

    // 🔥 Live depth-increasing eval on current position
const myToken = ++liveEvalSearch;
if (stockfish && sfReady) {
    stockfish.postMessage("stop");
    stockfish.postMessage("position fen " + pos.fen);
    stockfish.postMessage("go depth 20");

    const handler = (e) => {
        if (myToken !== liveEvalSearch) { stockfish.removeEventListener("message", handler); return; }
        const msg = e.data;
        if (typeof msg !== "string") return;
        if (msg.startsWith("bestmove")) { stockfish.removeEventListener("message", handler); return; }
        if (!msg.startsWith("info") || !msg.includes("score")) return;

        const d  = parseInt((msg.match(/\bdepth (\d+)/)      || [])[1]);
        const cp = (msg.match(/score cp (-?\d+)/)             || [])[1];
        const mt = (msg.match(/score mate (-?\d+)/)           || [])[1];
        if (isNaN(d)) return;

        const liveCp   = cp !== undefined ? +cp   : null;
        const liveMate = mt !== undefined ? +mt   : null;

        updateEvalBar(liveCp, liveMate, whiteTurn);

        const el = document.getElementById("evalDepth");
        if (el) el.textContent = `Depth: ${d}`;
    };

    stockfish.addEventListener("message", handler);
}
   
    updateActiveMoveCell(idx);
    showMoveDetail(idx, positions, analysisData);

    // Nav buttons
    const navPos = document.getElementById("navPos");
    navPos.textContent = idx === 0 ? "Start" : `${Math.ceil(idx / 2)}${idx % 2 === 1 ? "." : "…"}`;
    document.getElementById("navStart").disabled = idx === 0;
    document.getElementById("navPrev").disabled  = idx === 0;
    document.getElementById("navNext").disabled  = idx >= positions.length - 1;
    document.getElementById("navEnd").disabled   = idx >= positions.length - 1;

    if (canAnim) {
        // Forward → slide piece from origin to destination
        // Backward → slide it back from destination to origin (undo feel)
        const animFrom = idx > prevIdx ? pos.move.from : pos.move.to;
        const animTo   = idx > prevIdx ? pos.move.to   : pos.move.from;
        _animating = true;
        animateMove(animFrom, animTo, finalize);
    } else {
        finalize();
    }
}
