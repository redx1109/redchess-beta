// ─── Stockfish Live Analysis ────────────────────────────────────────────────
let isWhiteTurn = true;

// Tell Stockfish we're in UCI mode once
stockfish.postMessage("uci");
stockfish.postMessage("isready");

// Listen to everything Stockfish says
stockfish.onmessage = function (e) {
    const msg = e.data;

    // Only care about "info depth" lines (the live analysis updates)
    if (!msg.startsWith("info") || !msg.includes("depth")) return;

    // Skip lines without a score (e.g. pure seldepth lines)
    const hasScore = msg.includes("score cp") || msg.includes("score mate");
    if (!hasScore) return;

    // Parse depth (just for display if you want it)
    const depthMatch = msg.match(/\bdepth (\d+)/);
    const depth = depthMatch ? parseInt(depthMatch[1]) : null;

    // Parse centipawn score
    const cpMatch = msg.match(/score cp (-?\d+)/);
    const cp = cpMatch ? parseInt(cpMatch[1]) : null;

    // Parse mate score
    const mateMatch = msg.match(/score mate (-?\d+)/);
    const mate = mateMatch ? parseInt(mateMatch[1]) : null;

    // 🔥 Feed directly into YOUR existing function
    updateEvalBar(cp, mate, isWhiteTurn);

    // Optional: show depth somewhere in your UI
    if (depth) {
        const depthEl = document.getElementById("evalDepth");
        if (depthEl) depthEl.textContent = `Depth: ${depth}`;
    }
};

// ─── Call this after every move ─────────────────────────────────────────────
function analyzePosition(fen, whiteTurn) {
    isWhiteTurn = whiteTurn;

    stockfish.postMessage("stop");              // stop previous search
    stockfish.postMessage("ucinewgame");        // clear hash tables
    stockfish.postMessage(`position fen ${fen}`);
    stockfish.postMessage("go depth infinite");       // depth 25 is plenty, raise if you want
}

// ─── Eval Bar ──────────────────────────────────────────────────────────────────
// Matches chess.com eval bar behavior as closely as possible.

/**
 * Convert centipawns → fill percentage (White's share, 0–100).
 * chess.com uses a steeper sigmoid so the bar visually saturates
 * around ±300 cp rather than ±600 cp.
 *
 * Formula reverse-engineered from chess.com:
 *   k = 0.00368   →  50 cp ≈ 53.7 %, 100 cp ≈ 57.3 %, 300 cp ≈ 72 %
 */

function evalToPercent(cp) {
    if (cp === null || cp === undefined) return 50;

    // Clamp to avoid runaway values
    cp = Math.max(-1500, Math.min(1500, cp));

    // chess.com sigmoid (k tuned to match their visual output)
    const winProb = 1 / (1 + Math.exp(-0.00368 * cp));

    return winProb * 100;
}

/**
 * Format the numeric label exactly like chess.com:
 *   +1.3  /  -0.5  /  0.0  /  M4  /  -M3
 */
function formatEval(cp, mate) {
    if (mate !== null && mate !== undefined) {
        // chess.com writes "M4" for White mating and "-M4" for Black mating
        return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
    }
    if (cp === null || cp === undefined) return "0.0";

    const pawns = cp / 100;
    // Fix "-0.0" display bug
    if (Math.abs(pawns) < 0.05) return "0.0";

    return (cp > 0 ? "+" : "") + pawns.toFixed(1);
}

/**
 * Update the eval bar DOM elements.
 *
 * @param {number|null} cp          Centipawn evaluation
 * @param {number|null} mate        Moves to mate (positive = White mates, negative = Black mates)
 * @param {boolean}     isWhiteTurn Whether it is currently White's turn
 *
 * Expected HTML structure:
 *   <div id="evalBar">
 *     <div id="evalLabelTop"></div>   ← sits at the top (Black's region)
 *     <div id="evalFill"></div>       ← height = White's winning %, grows upward via flex-column-reverse or bottom-anchoring
 *     <div id="evalLabelBot"></div>   ← sits at the bottom (White's region)
 *   </div>
 *
 * CSS hint for the fill div:
 *   position: absolute; bottom: 0; left: 0; right: 0;
 *   background: #f0e8d0;   (White color)
 *   transition: height 0.3s ease;
 */
function updateEvalBar(cp, mate, isWhiteTurn) {
    const fill     = document.getElementById("evalFill");
    const labelTop = document.getElementById("evalLabelTop");
    const labelBot = document.getElementById("evalLabelBot");
    if (!fill) return;

    // ── Step 1: normalise to White's POV ────────────────────────────────────
    // If your engine reports from the side-to-move's perspective (most UCI
    // engines in "go" mode report from the engine's POV), flip when Black moves.
    // If your engine ALWAYS reports from White's POV, comment this block out.
    if (!isWhiteTurn) {
        if (cp   !== null && cp   !== undefined) cp   = -cp;
        if (mate !== null && mate !== undefined) mate = -mate;
    }

    // ── Step 2: compute fill percentage (White's share) ─────────────────────
    let pct;

    if (mate !== null && mate !== undefined) {
        // chess.com pins the bar to ~97 % / ~3 % for any forced mate,
        // regardless of how far away it is (M1 and M20 look the same).
        pct = mate > 0 ? 97 : 3;
    } else {
        pct = evalToPercent(cp);
    }

    // Hard clamp so the bar never fully disappears on either side
    pct = Math.max(3, Math.min(97, pct));

    // ── Step 3: apply to DOM ─────────────────────────────────────────────────
    fill.style.height = pct + "%";

    const txt = formatEval(cp, mate);

    // Label appears in the LARGER region, coloured to contrast its background.
    // White region  → bottom label, dark text on light fill
    // Black region  → top label,    light text on dark background
    if (pct >= 50) {
        // White is ahead — label goes into White's (bottom) region
        labelTop.textContent = "";
        labelBot.textContent = txt;
        labelBot.style.color = "#1a1814";   // dark text on white fill
        labelTop.style.color = "#f0e8d0";   // (unused but kept consistent)
    } else {
        // Black is ahead — label goes into Black's (top) region
        labelTop.textContent = txt;
        labelBot.textContent = "";
        labelTop.style.color = "#f0e8d0";   // light text on dark background
        labelBot.style.color = "#1a1814";   // (unused but kept consistent)
    }
}
