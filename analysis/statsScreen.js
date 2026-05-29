/* ══════════════════════════════════════════════════════════════
   RED CHESS — STATS SCREEN  (accuracy rings, phase bars, progress)
   ══════════════════════════════════════════════════════════════ */

// ─── Progress bar ─────────────────────────────────────────────────────────────

function setProgress(pct) {
    document.getElementById("analysingFill").style.width = pct + "%";
}

// ─── SVG accuracy ring ────────────────────────────────────────────────────────

function setRing(id, pct) {
    const circ = 2 * Math.PI * 32; // r=32
    const el   = document.getElementById(id);
    if (!el) return;
    const filled = (pct / 100) * circ;
    el.setAttribute("stroke-dasharray", `${filled.toFixed(2)} ${(circ - filled).toFixed(2)}`);
}

// ─── Live accuracy updater ────────────────────────────────────────────────────

function updateLiveAccuracy(wAcc, wN, bAcc, bN, phases) {
    const wVal = wN ? (wAcc / wN).toFixed(1) : null;
    const bVal = bN ? (bAcc / bN).toFixed(1) : null;

    document.getElementById("statsAccWhite").textContent = wVal ? wVal + "%" : "—";
    document.getElementById("statsAccBlack").textContent = bVal ? bVal + "%" : "—";

    if (wVal) setRing("ringWhite", +wVal);
    if (bVal) setRing("ringBlack", +bVal);

    // Phase values (text only; bars filled at the end)
    const pv = (ph, side) => {
        const n = ph[side + "N"], a = ph[side + "A"];
        return n ? (a / n).toFixed(1) + "%" : "—";
    };
    document.getElementById("phOpenW").textContent = pv(phases.open, "w");
    document.getElementById("phOpenB").textContent = pv(phases.open, "b");
    document.getElementById("phMidW").textContent  = pv(phases.mid,  "w");
    document.getElementById("phMidB").textContent  = pv(phases.mid,  "b");
    document.getElementById("phEndW").textContent  = pv(phases.end,  "w");
    document.getElementById("phEndB").textContent  = pv(phases.end,  "b");
}

// ─── Phase bars ───────────────────────────────────────────────────────────────

function fillPhaseBars(phases) {
    const set = (fillId, pct) => {
        const el = document.getElementById(fillId);
        if (el) el.style.width = Math.min(100, pct).toFixed(1) + "%";
    };
    const pct = (ph, side) => ph[side + "N"] ? ph[side + "A"] / ph[side + "N"] : 0;
    set("phFillOpenW", pct(phases.open, "w"));
    set("phFillOpenB", pct(phases.open, "b"));
    set("phFillMidW",  pct(phases.mid,  "w"));
    set("phFillMidB",  pct(phases.mid,  "b"));
    set("phFillEndW",  pct(phases.end,  "w"));
    set("phFillEndB",  pct(phases.end,  "b"));
}