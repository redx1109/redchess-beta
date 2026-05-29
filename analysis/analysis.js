/* ══════════════════════════════════════════════════════════════
   RED CHESS — ANALYSIS  v3  (core orchestrator)

   Module load order in HTML:
     1. stockfish.js      — engine worker + evalPosition
     2. pgn.js            — parsePGN + fetchLichessGames + fetchChessComGames
     3. gamesScreen.js    — buildGamesScreen, esc, buildSummaryGrid
     4. statsScreen.js    — setProgress, setRing, updateLiveAccuracy, fillPhaseBars
     5. board.js          — renderPosition, buildMoveList, goToMove
     6. movefeedback.js   — classifyMove, moveAccuracy, showMoveDetail, getClassIcon
     7. evalbar.js        — updateEvalBar, drawArrow
     8. analysis.js       ← this file
     9. events.js         — all addEventListener bindings
   ══════════════════════════════════════════════════════════════ */
// ─── Constants ────────────────────────────────────────────────────────────────

const CLASSIFICATIONS = [
    { name: "brilliant",  label: "Brilliant"  },
    { name: "great",      label: "Great"      },
    { name: "best",       label: "Best"       },
    { name: "excellent",  label: "Excellent"  },
    { name: "good",       label: "Good"       },
    { name: "book",       label: "Book"       },
    { name: "inaccuracy", label: "Inaccuracy" },
    { name: "mistake",    label: "Mistake"    },
    { name: "blunder",    label: "Blunder"    },
    { name: "miss",       label: "Miss"       },
];

// ─── State ────────────────────────────────────────────────────────────────────

let positions    = [];   // {fen, san, color, move}
let analysisData = [];   // {cp, mate, bestMove, classification, cpLoss, acc}
let currentIdx   = 0;
let isAnalysing  = false;
let fetchedGames = [];
let totalPlies   = 0;

const S           = JSON.parse(localStorage.getItem("chessSettings") || "{}");
const boardTheme  = S.board || "green";
const pieceFolder = S.piece || "default";

// ─── Screen management ────────────────────────────────────────────────────────

function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s =>
        s.classList.toggle("hidden", s.id !== id)
    );
    window.scrollTo({ top: 0, behavior: "instant" });
}

// ─── Status helper (selection screen) ────────────────────────────────────────

function setSelStatus(html, spinner = false) {
    const el = document.getElementById("selStatus");
    el.innerHTML = spinner ? `<span class="spinner"></span>${html}` : html;
}

// ─── Sounds ───────────────────────────────────────────────────────────────────

const SFX = {
    move:    tryAudio("../sounds/move.mp3"),
    capture: tryAudio("../sounds/capture.mp3"),
};
function tryAudio(src) {
    try { return new Audio(src); } catch { return null; }
}
function playSound(name) {
    const a = SFX[name];
    if (!a) return;
    a.currentTime = 0;
    a.play().catch(() => {});
}

// ─── Start game (PGN → stats screen) ─────────────────────────────────────────

function startGame(pgn) {
    isAnalysing = false;
    const parsed = parsePGN(pgn);
    if (!parsed) { setSelStatus("Failed to parse PGN"); return; }

    positions    = parsed.positions;
    analysisData = new Array(positions.length).fill(null).map(() => ({}));
    currentIdx   = 0;
    totalPlies   = positions.length - 1;

    const h      = parsed.headers;
    const white  = h.White  || "White";
    const black  = h.Black  || "Black";
    const result = h.Result || "—";
    const date   = h.Date   || "—";

    // Stats screen header
    document.getElementById("statsWhiteName").textContent = white;
    document.getElementById("statsBlackName").textContent = black;
    document.getElementById("statsResult").textContent    = result;

    // Game info card
    document.getElementById("ginfoWhite").textContent  = white;
    document.getElementById("ginfoBlack").textContent  = black;
    document.getElementById("ginfoResult").textContent = result;
    document.getElementById("ginfoDate").textContent   = date;
    document.getElementById("ginfoMoves").textContent  = Math.ceil(totalPlies / 2);

    // Player names on board screen
    document.getElementById("topPlayerName").textContent    = black;
    document.getElementById("bottomPlayerName").textContent = white;

    // Accuracy display names
    document.getElementById("accWhiteName").textContent = white;
    document.getElementById("accBlackName").textContent = black;

    // Reset accuracy display
    document.getElementById("statsAccWhite").textContent = "—";
    document.getElementById("statsAccBlack").textContent = "—";
    setRing("ringWhite", 0);
    setRing("ringBlack", 0);

    // Reset phase bars
    ["OpenW","OpenB","MidW","MidB","EndW","EndB"].forEach(id => {
        const el = document.getElementById("phFill" + id);
        if (el) el.style.width = "0%";
        const vId  = id.startsWith("Open") ? "phOpen" : id.startsWith("Mid") ? "phMid" : "phEnd";
        const side = id.endsWith("W") ? "W" : "B";
        const vel  = document.getElementById(vId + side);
        if (vel) vel.textContent = "—";
    });

    // Reset move summary and progress
    document.getElementById("summaryGrid").innerHTML = "";
    setProgress(0);
    document.getElementById("analysingLabel").textContent = "Analysing…";

    // Board screen: starting position
    renderPosition(positions[0].fen);
    updateEvalBar(0, null, true);
    document.getElementById("moveList").innerHTML = "";
    document.getElementById("moveDetail").style.display = "none";
    document.getElementById("navPos").textContent = "Start";

    showScreen("screenStats");
    runAnalysis();
}

// ─── Analysis runner ──────────────────────────────────────────────────────────

/**
 * Determine game phase from a FEN string and ply index.
 *
 * Opening   → first 20 plies (structural development)
 * Endgame   → queens gone OR ≤ 6 major/minor pieces remain
 * Middlegame → everything between
 */
function getPhase(fen, plyIndex) {
    if (plyIndex <= 20) return "open";

    const pieceStr   = fen.split(" ")[0].replace(/[^rnbqRNBQ]/g, "");
    const queens     = (pieceStr.match(/[qQ]/g) ?? []).length;
    const majorMinor = pieceStr.length;

    if (queens === 0 || majorMinor <= 6) return "end";
    return "mid";
}

async function runAnalysis() {
    isAnalysing = true;

    // ── Wait for engine ──────────────────────────────────────────────────────
    if (stockfish && !sfReady) {
        await new Promise(res => {
            const t = setInterval(() => { if (sfReady) { clearInterval(t); res(); } }, 80);
        });
    }

    // ── No-engine fallback ───────────────────────────────────────────────────
    if (!stockfish || !sfReady) {
        document.getElementById("analysingLabel").textContent = "No engine — position view only";
        setProgress(100);
        buildMoveList();
        return;
    }

    // ── Accumulators ─────────────────────────────────────────────────────────
    let whiteAcc = 0, blackAcc = 0, wN = 0, bN = 0;

    const phases = {
        open: { wA: 0, bA: 0, wN: 0, bN: 0 },
        mid:  { wA: 0, bA: 0, wN: 0, bN: 0 },
        end:  { wA: 0, bA: 0, wN: 0, bN: 0 },
    };

    const total = positions.length;

    // ── Main loop ────────────────────────────────────────────────────────────
    for (let i = 0; i < total; i++) {
        if (!isAnalysing) break;

        const result = await evalPosition(positions[i].fen);
        if (!result) continue;

        // Store engine output
        const entry = analysisData[i];
        entry.cp       = result.cp;
        entry.cpWhite  = result.cp ?? 0;  // raw White-POV cp — always matches eval bar
        entry.mate     = result.mate;
        entry.bestMove = result.bestMove;

        // ── Per-move classification (skip position 0 — no previous move) ──
        if (i > 0) {
            const prev    = analysisData[i - 1];
            const isWhite = positions[i].color === "w";

            // Use 0 for missing CP (e.g. a mate was found last move)
            const cpPrev = prev.cp  ?? 0;
            const cpNow  = result.cp ?? 0;

            const played  = positions[i].move
                ? positions[i].move.from + positions[i].move.to
                : null;

            const fenBefore  = positions[i - 1].fen;
const fenAfter   = positions[i].fen;
const sideBefore = fenBefore.split(' ')[1];  // 'w' or 'b'
const sideAfter  = fenAfter.split(' ')[1];

// Normalize to White's POV (Stockfish returns side-to-move POV)
const cpBeforeWP = sideBefore === 'b' ? -cpPrev : cpPrev;
const cpAfterWP  = sideAfter  === 'b' ? -cpNow  : cpNow;

const cls = classifyMove(
    cpBeforeWP,
    cpAfterWP,
    isWhite,
    i,
    played,
    prev.bestMove,
    positions[i].move,
    fenAfter,
    null,   // cpBestAfter not available
    1500    // playerRating — swap for actual rating if you have it
);

const acc = moveAccuracy(cpBeforeWP, cpAfterWP, isWhite);

entry.fenAfter       = fenAfter;
entry.classification = cls;
entry.acc            = acc;
entry.cpLoss         = Math.max(0, isWhite ? cpBeforeWP - cpAfterWP : cpAfterWP - cpBeforeWP);
            // Overall accuracy
            if (isWhite) { whiteAcc += acc; wN++; }
            else         { blackAcc += acc; bN++; }

            // Phase accuracy — material-aware
            const ph = phases[getPhase(fenAfter, i)];
            if (isWhite) { ph.wA += acc; ph.wN++; }
            else         { ph.bA += acc; ph.bN++; }

            // Live accuracy — update every 5 plies and on the last position
            if (i % 5 === 0 || i === total - 1) {
                updateLiveAccuracy(whiteAcc, wN, blackAcc, bN, phases);
            }
        }

        // Progress bar
        const pct = Math.round((i / Math.max(total - 1, 1)) * 100);
        setProgress(pct);
        document.getElementById("analysingLabel").textContent =
            `Analysing… ${pct}%  (${Math.ceil(i / 2)} / ${Math.ceil(total / 2)} moves)`;
    }

    // ── Finalise ─────────────────────────────────────────────────────────────
    isAnalysing = false;
    setProgress(100);
    document.getElementById("analysingLabel").textContent =
        isAnalysing ? "Analysis stopped" : "Analysis complete";

    updateLiveAccuracy(whiteAcc, wN, blackAcc, bN, phases);
    setTimeout(() => fillPhaseBars(phases), 100);
    buildSummaryGrid(analysisData, positions);
    buildMoveList();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

initStockfish();

const savedPGN = localStorage.getItem("chessAnalysisPGN");
localStorage.removeItem("chessAnalysisPGN");
if (savedPGN) {
    // Auto-load PGN
    startGame(savedPGN);
} else {
    // No saved game
    showScreen("screenSelection");
}
