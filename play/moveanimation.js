// moveanimation.js — piece movement & drag animation

(function injectAnimationStyles() {
    if (document.getElementById("moveanimation-styles")) return;
    document.head.insertAdjacentHTML("beforeend", `<style id="moveanimation-styles">
@keyframes bracketIn  { from { opacity:0; transform:scale(.6) } to { opacity:1; transform:scale(1) } }
@keyframes fillPulse  { 0%,100% { opacity:.18 } 50% { opacity:.36 } }
@keyframes checkGlowPulse { 0%,100% { opacity:.55 } 50% { opacity:.9 } }
@keyframes checkRingPulse { 0%,100% { transform:scale(1); opacity:.7 } 50% { transform:scale(1.06); opacity:1 } }
@keyframes checkPieceFlash {
    0%,100% { filter:none }
    20% { filter:drop-shadow(0 0 8px rgba(220,50,50,1)) drop-shadow(0 0 18px rgba(220,50,50,.7)) brightness(1.35) }
    40% { filter:none }
    60% { filter:drop-shadow(0 0 6px rgba(220,50,50,.9)) brightness(1.2) }
    80% { filter:none }
}
@keyframes boardShake {
    0%       { transform:translate(0,0) rotate(0deg) }
    10%      { transform:translate(-5px,-3px) rotate(-.4deg) }
    20%      { transform:translate(5px,3px) rotate(.4deg) }
    30%      { transform:translate(-4px,2px) rotate(-.3deg) }
    40%      { transform:translate(4px,-2px) rotate(.3deg) }
    50%      { transform:translate(-2px,1px) rotate(-.15deg) }
    60%      { transform:translate(2px,-1px) rotate(.15deg) }
    75%      { transform:translate(-1px,.5px) }
    90%,100% { transform:translate(0,0) rotate(0deg) }
}

.square.drag-hover { z-index:2 }
.dh-fill {
    position:absolute; inset:0; pointer-events:none; z-index:6;
    background:radial-gradient(circle at center,rgba(201,168,76,.38) 0%,rgba(201,168,76,.08) 70%,transparent 100%);
    animation:fillPulse .7s ease-in-out infinite;
}
.dh-bracket {
    position:absolute; width:28%; height:28%; pointer-events:none; z-index:7;
    animation:bracketIn .15s cubic-bezier(.2,1.4,.4,1) both;
}
.dh-bracket::before,.dh-bracket::after { content:''; position:absolute; background:#c9a84c; border-radius:1px }
.dh-bracket::before { width:100%; height:3px }
.dh-bracket::after  { width:3px; height:100% }
.dh-tl { top:6%; left:6% }    .dh-tl::before,.dh-tl::after  { top:0; left:0 }
.dh-tr { top:6%; right:6% }   .dh-tr::before,.dh-tr::after  { top:0; right:0; left:auto }
.dh-bl { bottom:6%; left:6% } .dh-bl::before,.dh-bl::after  { bottom:0; top:auto; left:0 }
.dh-br { bottom:6%; right:6% } .dh-br::before,.dh-br::after { bottom:0; top:auto; right:0; left:auto }

.check-fill {
    position:absolute; inset:0; pointer-events:none; z-index:5; border-radius:2px;
    background:radial-gradient(circle at center,rgba(220,50,50,.55) 0%,rgba(220,50,50,.22) 55%,transparent 100%);
    animation:checkGlowPulse 1.1s ease-in-out infinite;
}
.check-ring {
    position:absolute; inset:3px; border:2.5px solid rgba(220,50,50,.85);
    border-radius:3px; pointer-events:none; z-index:6;
    box-shadow:inset 0 0 8px rgba(220,50,50,.3),0 0 8px rgba(220,50,50,.3);
    animation:checkRingPulse 1.1s ease-in-out infinite;
}
.piece.check-flash { animation:checkPieceFlash .65s ease-out forwards }
.board-check-shake { animation:boardShake .42s cubic-bezier(.36,.07,.19,.97) both }
</style>`);
})();

// ─── Shared state ─────────────────────────────────────────────────────────────

let _animating  = false;
let _animCancel = false;

function cancelAnimation() { _animCancel = true; _animating = false; }

// ─── Bot move animation ───────────────────────────────────────────────────────

function animateGameMove(fromRow, fromCol, toRow, toCol, onDone) {
    if (_animating) _animCancel = true;

    const fromEl = boardEl.querySelector(`[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const toEl   = boardEl.querySelector(`[data-row="${toRow}"][data-col="${toCol}"]`);
    const piece  = fromEl?.querySelector(".piece");
    if (!piece || !fromEl || !toEl) { onDone(); return; }

    document.querySelectorAll("img.anim-ghost").forEach(g => g.remove());
    _animating = true; _animCancel = false;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect   = toEl.getBoundingClientRect();
    const x0 = fromRect.left + fromRect.width  / 2;
    const y0 = fromRect.top  + fromRect.height / 2;
    const x1 = toRect.left   + toRect.width    / 2;
    const y1 = toRect.top    + toRect.height   / 2;

    const dist  = Math.hypot(x1 - x0, y1 - y0);
    const DUR   = Math.min(155, Math.max(95, dist * 0.38));
    const arcH  = Math.min(30, dist * 0.13);
    const ctrlX = x0 + (x1 - x0) * 0.4;
    const ctrlY = Math.min(y0, y1) - arcH;
    const size  = fromRect.width * 1.15;

    const ghost = document.createElement("img");
    ghost.src       = piece.src;
    ghost.className = "anim-ghost";
    ghost.style.cssText = `position:fixed;width:${size}px;height:${size}px;left:0;top:0;
        object-fit:contain;pointer-events:none;z-index:999;
        will-change:transform,filter;transform-origin:50% 50%`;
    piece.style.opacity = "0";
    document.body.appendChild(ghost);

    const startTime = performance.now();
    let _done = false;
    const fireOnDone = () => {
        if (_done) return;
        _done = true; _animating = false; onDone();
    };

    const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

    function tick(now) {
        if (_animCancel) { ghost.remove(); fireOnDone(); return; }

        const raw = Math.min(1, (now - startTime) / DUR);
        const t   = easeOutQuart(raw);
        const inv = 1 - t;

        const bx      = inv*inv*x0 + 2*inv*t*ctrlX + t*t*x1;
        const by      = inv*inv*y0 + 2*inv*t*ctrlY + t*t*y1;
        const midPeak = Math.sin(t * Math.PI);
        const scale   = 1 + midPeak * 0.25;
        const shadowY = 6  + midPeak * 18;
        const shadowB = 10 + midPeak * 22;
        const shadowO = 0.5 + midPeak * 0.45;

        ghost.style.transform = `translate(${bx - size/2}px,${by - size/2}px) scale(${scale})`;
        ghost.style.filter    = `drop-shadow(0 ${shadowY}px ${shadowB}px rgba(0,0,0,${shadowO}))
                                  drop-shadow(0 0 ${midPeak*14}px rgba(201,168,76,${midPeak*.5}))`;

        if (raw < 1) { requestAnimationFrame(tick); return; }

        // Ghost hidden BEFORE renderBoard fires → board repaints while ghost is invisible → no flicker
        ghost.style.transition = "none";
        ghost.style.opacity    = "0";
        fireOnDone();
        requestAnimationFrame(() => ghost.remove());
    }

    requestAnimationFrame(tick);
}

// ─── Drag helpers ─────────────────────────────────────────────────────────────

let _hoveredSq  = null;
let _dimOverlay = null;
let _dragPiece  = null;   // reference to the lifted board piece element

function getDragSize() {
    const sq = boardEl.querySelector(".square");
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    return sq ? sq.getBoundingClientRect().width * (isTouch ? 1.0 : 1.28) : 80;
}

// Lifts the ACTUAL piece element off the board into document.body.
// Moving it to body puts it outside every board stacking context / overflow,
// so it is always visible while being dragged.
function createDragEl(src, startX, startY) {
    const size = getDragSize();
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    const liftY = isTouch ? size * 0.5 : size * 0.72;

    const hitEl  = document.elementFromPoint(startX, startY);
    const hitSq  = hitEl?.closest("[data-row]");
    _dragPiece   = hitSq?.querySelector(".piece") ?? null;

    const img = _dragPiece ?? document.createElement("img");

    if (!_dragPiece) {
        img.src       = src;
        img.className = "anim-ghost";
    }

    document.body.appendChild(img);

    img.style.cssText = `
        position:fixed; left:0; top:0;
        width:${size}px; height:${size}px;
        object-fit:contain; pointer-events:none;
        z-index:1000; transform-origin:50% 50%;
        will-change:transform,filter;
        transform:translate(${startX - size/2}px,${startY - liftY}px) scale(1.22);
        filter:drop-shadow(0 18px 36px rgba(0,0,0,.85))
               drop-shadow(0 6px 12px rgba(0,0,0,.6))
               drop-shadow(0 0 16px rgba(201,168,76,.45));
    `;

    _dimOverlay = createDimOverlay();
    return img;
}

function createDimOverlay() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0);pointer-events:none;z-index:998;transition:background .18s ease";
    document.body.appendChild(el);
    el.getBoundingClientRect();
    el.style.background = "rgba(0,0,0,.22)";
    return el;
}

function removeDimOverlay() {
    if (!_dimOverlay) return;
    _dimOverlay.style.background = "rgba(0,0,0,0)";
    setTimeout(() => { _dimOverlay?.remove(); _dimOverlay = null; }, 200);
}

// ─── Drag-hover highlight ─────────────────────────────────────────────────────

function setHoverSquare(sqEl) {
    if (_hoveredSq === sqEl) return;
    clearHoverSquare();
    _hoveredSq = sqEl;
    if (!sqEl) return;

    const row = parseInt(sqEl.dataset.row), col = parseInt(sqEl.dataset.col);
    if (!highlights.some(([r, c]) => r === row && c === col)) { _hoveredSq = null; return; }

    sqEl.classList.add("drag-hover");
    ["tl","tr","bl","br"].forEach(pos => {
        const b = document.createElement("div");
        b.className = `dh-inner dh-bracket dh-${pos}`;
        sqEl.appendChild(b);
    });
    const fill = document.createElement("div");
    fill.className = "dh-inner dh-fill";
    sqEl.appendChild(fill);
}

function clearHoverSquare() {
    if (_hoveredSq) {
        _hoveredSq.classList.remove("drag-hover");
        _hoveredSq.querySelectorAll(".dh-inner").forEach(n => n.remove());
    }
    _hoveredSq = null;
}

// ─── Shake (invalid drop) ─────────────────────────────────────────────────────

function shakeDragEl() {
    if (!dragEl) return;
    const size = getDragSize();
    const seq  = [8, -8, 5, -5, 2, 0];
    let i = 0;
    const step = () => {
        if (!dragEl || i >= seq.length) return;
        dragEl.style.transition = "transform .045s ease-out";
        dragEl.style.transform  = `translate(${_curX - size/2 + seq[i++]}px,${_curY - size*.72}px) scale(1.22)`;
        setTimeout(step, 45);
    };
    step();
}

// ─── Drag landing ─────────────────────────────────────────────────────────────
// Glides the piece to the destination square at scale 1, then:
//   1. renderBoard() repaints — fresh piece appears in the square
//   2. Next rAF: remove the dragged element from body
// Both images are at scale 1 in the same position for one frame → no visible pop.

function animateDragLanding(toRow, toCol, isCapture, onDone) {
    if (!dragEl) { onDone?.(); return; }

    const toEl = boardEl.querySelector(`[data-row="${toRow}"][data-col="${toCol}"]`);
    if (!toEl) { onDone?.(); return; }

    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

    const { left, top, width, height } = toEl.getBoundingClientRect();
    const cx   = left + width  / 2;
    const cy   = top  + height / 2;
    const size = getDragSize();

    clearHoverSquare();
    removeDimOverlay();

    // Scale back to 1× as it settles onto the square
    dragEl.style.transition = "transform .15s cubic-bezier(.3,1.3,.4,1), filter .15s ease";
    dragEl.style.transform  = `translate(${cx - size/2}px,${cy - size/2}px) scale(1)`;
    dragEl.style.filter     = "drop-shadow(0 3px 6px rgba(0,0,0,.35))";

    const el = dragEl;   // local ref — dragEl will be nulled before timeout fires
    setTimeout(() => {
        onDone?.();                          // renderBoard paints piece in new square
        requestAnimationFrame(() => {
            el.remove();                     // remove the lifted element from body
            _dragPiece = null;
        });
        dragEl = null;
    }, 160);
}

// ─── Check animation ──────────────────────────────────────────────────────────

let _checkSquareEl = null;

function enterCheck(kingSquareEl) {
    clearCheck();
    _checkSquareEl = kingSquareEl;

    boardEl.classList.remove("board-check-shake");
    void boardEl.offsetWidth;
    boardEl.classList.add("board-check-shake");
    boardEl.addEventListener("animationend", function _end(e) {
        if (e.animationName !== "boardShake") return;
        boardEl.classList.remove("board-check-shake");
        boardEl.removeEventListener("animationend", _end);
    });

    const piece = kingSquareEl.querySelector(".piece");
    if (piece) {
        piece.classList.remove("check-flash");
        void piece.offsetWidth;
        piece.classList.add("check-flash");
        piece.addEventListener("animationend", function _end(e) {
            if (e.animationName !== "checkPieceFlash") return;
            piece.classList.remove("check-flash");
            piece.removeEventListener("animationend", _end);
        });
    }

    kingSquareEl.classList.add("in-check");
    ["check-fill","check-ring"].forEach(cls => {
        const el = document.createElement("div");
        el.className = `ck-inner ${cls}`;
        kingSquareEl.appendChild(el);
    });
}

function clearCheck() {
    if (!_checkSquareEl) return;
    _checkSquareEl.classList.remove("in-check");
    _checkSquareEl.querySelectorAll(".ck-inner").forEach(n => n.remove());
    _checkSquareEl.querySelector(".piece")?.classList.remove("check-flash");
    _checkSquareEl = null;
}

// ─── Drag loop (breathing + tilt) ────────────────────────────────────────────

let _rafId = null, _curX = 0, _curY = 0, _dragT0 = 0;

function _dragLoop(now) {
    if (!dragEl) { _rafId = null; return; }

    const size = getDragSize();
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    const liftY = isTouch ? size * 0.5 : size * 0.72;
    const t = (now - _dragT0) / 1000;

    _dragVX *= 0.82;
    const tilt         = Math.max(-14, Math.min(14, _dragVX * 1.2));
    const breatheY     = Math.sin(t * 3.8) * 2.8;
    const breatheScale = 1.22 + Math.sin(t * 3.8) * 0.018;
    const breatheTilt  = tilt + Math.sin(t * 2.1) * 0.8;

    dragEl.style.transform = `translate(${_curX - size/2}px,${_curY - liftY + breatheY}px) scale(${breatheScale}) rotate(${breatheTilt}deg)`;

    const shadowY = 20 + Math.sin(t * 3.8) * 4;
    const shadowB = 38 + Math.sin(t * 3.8) * 6;
    const shadowX = tilt * 0.7;
    dragEl.style.filter = [
        `drop-shadow(${shadowX}px ${shadowY}px ${shadowB}px rgba(0,0,0,.88))`,
        `drop-shadow(${shadowX*.4}px 7px 14px rgba(0,0,0,.6))`,
        `drop-shadow(0 0 ${14 + Math.sin(t*3.8)*4}px rgba(201,168,76,.42))`,
    ].join(" ");

    _rafId = requestAnimationFrame(_dragLoop);
}
