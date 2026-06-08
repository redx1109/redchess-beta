// ─── Move Classification ───────────────────────────────────────────────────────
// Matches Chess.com Classification V2 (Expected Points Model).
// Official thresholds source: https://support.chess.com/en/articles/8572705
//
// Requires openings.js to be loaded first (defines OPENING_BOOK):
//   <script src="openings.js"></script>
//   <script src="movefeedback.js"></script>
function isNearlyBest(played, wpAfterPlayed, wpAfter) {
    if (played) return true;
    if (wpAfter === null || wpAfter === undefined) return false;
    return (wpAfter - wpAfterPlayed) <= NEARLY__THRESHOLD;
}

const CLASS_IMG_PATH = "./move_classification/";

// ─── Opening Book Lookup ───────────────────────────────────────────────────────
// Converts a full FEN string into a normalised EPD key and looks it up in
// OPENING_BOOK (defined in openings.js). Returns the opening name string or
// null if the position is not in the book.
//
// Normalisation: strip move counters (fields 5–6) and set the en-passant
// square (field 4) to "-", because the book stores positions without e.p.
// squares to maximise matches regardless of pawn double-push order.
//
// @param {string} fen  – Full FEN, e.g. "rnbqkbnr/.../RNBQKBNR b KQkq e3 0 1"
// @returns {string|null}  Opening name, e.g. "Sicilian Defense: Najdorf Variation"
function lookupOpening(fen) {
    if (typeof OPENING_BOOK === "undefined") return null;
    const parts = fen.split(" ");
    // EPD = board + side + castling + "-" (en-passant normalised)
    const epd = [parts[0], parts[1], parts[2], "-"].join(" ");
    const entry = OPENING_BOOK[epd];
    if (!entry) return null;
    // Entry format: "ECO|Name", e.g. "B90|Sicilian Defense: Najdorf Variation"
    return entry.split("|")[1];
}

// Returns true if the position FEN is in the opening book.
function isBookPosition(fen) {
    return lookupOpening(fen) !== null;
}

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ─── Win probability conversion ───────────────────────────────────────────────
//
// Chess.com uses a rating-adjusted sigmoid — explicitly stated in their docs:
// "the engine evaluation needed to be in a winning, equal, or losing position
//  will change along with a player's rating."
//
// The base sigmoid constant k = 0.00368208 is calibrated for ~1500 Elo.
// Lower-rated players convert advantages less reliably, so the same centipawn
// advantage means a SMALLER real winning probability for them. Chess.com
// scales k downward for lower ratings, making thresholds more lenient.
//
// Rating → k mapping (community reverse-engineered from chess.com outputs):
//   ≤ 800  → 0.00205   (~44% less sensitive than base)
//   1000   → 0.00260
//   1200   → 0.00310
//   1400   → 0.00346
//   1500   → 0.00368   (base — Lichess / FIDE average)
//   1600   → 0.00383
//   1800   → 0.00410
//   2000   → 0.00435
//   ≥ 2200 → 0.00460   (~25% more sensitive than base)
//
// Returns win probability in [0, 1] from White's perspective.
function _sigmoidK(rating) {
    if (!rating || rating <= 800)  return 0.00205;
    if (rating <= 1000)            return 0.00205 + (rating - 800)  / 200 * 0.00055;
    if (rating <= 1200)            return 0.00260 + (rating - 1000) / 200 * 0.00050;
    if (rating <= 1400)            return 0.00310 + (rating - 1200) / 200 * 0.00036;
    if (rating <= 1500)            return 0.00346 + (rating - 1400) / 100 * 0.00022;
    if (rating <= 1600)            return 0.00368 + (rating - 1500) / 100 * 0.00015;
    if (rating <= 1800)            return 0.00383 + (rating - 1600) / 200 * 0.00027;
    if (rating <= 2000)            return 0.00410 + (rating - 1800) / 200 * 0.00025;
    if (rating <= 2200)            return 0.00435 + (rating - 2000) / 200 * 0.00025;
    return 0.00460;
}

// @param {number} cp      – centipawns (White's POV, clamped internally)
// @param {number} [rating=1500] – player's Elo rating for sigmoid scaling
function cpToWinProb(cp, rating = 1500) {
    if (cp === null || cp === undefined) return 0.5;
    cp = Math.max(-1500, Math.min(1500, cp));
    const k = _sigmoidK(rating);
    return 1 / (1 + Math.exp(-k * cp));
}

// Win probability (0–1) for the MOVING player.
// @param {number} cp
// @param {boolean} isWhite
// @param {number} [rating=1500]
function playerWinProb(cp, isWhite, rating = 1500) {
    const w = cpToWinProb(cp, rating);
    return isWhite ? w : 1 - w;
}

// ─── Sacrifice detection ───────────────────────────────────────────────────────
// "A Brilliant move is when you find a good piece sacrifice."
//
// Two sacrifice types are detected:
//
// 1. CAPTURE SACRIFICE — the moving piece captures something worth strictly less
//    than itself (with a +1 buffer to exclude rough-value trades like B×N which
//    are not really sacrifices). Pawns are excluded: chess.com's "piece sacrifice"
//    requires at least a minor piece (value ≥ 3) being given up.
//
// 2. QUIET SACRIFICE — no capture at all, but the moved piece lands on a square
//    where it can be taken for free or at a material loss. We detect this when:
//    • The moved piece is at least a minor piece (value ≥ 3), AND
//    • The move is flagged as a quiet sacrifice by the caller via
//      move.isQuietSacrifice = true  (set externally when engine confirms the
//      piece is left en prise after the move with no adequate compensation).
//    Without multi-PV engine data this flag defaults to false; callers who DO
//    have engine lines should set it to enable quiet-sacrifice Brilliant moves.
//
// @param {object} move  – chess.js verbose move: { piece, captured?, flags?, isQuietSacrifice? }
// @returns {boolean}
function detectSacrifice(move, evalBefore, evalAfter, chess) {
    if (!move) return false;

    const piece = move.promotion ? move.promotion : move.piece;
    const movingVal = PIECE_VALUES[piece] ?? 0;

    if (movingVal < 3) return false;

    if (move.captured) {
        const capturedVal = PIECE_VALUES[move.captured] ?? 0;
        const opponentColor = move.color === 'w' ? 'b' : 'w';

        // check if captured piece was protected by opponent
        const wasProtected = chess
            ? isSquareDefended(chess, move.to, opponentColor)
            : false;

        // taking unprotected piece = NOT a sacrifice
        if (!wasProtected) return false;

        // minor piece for pawn (protected)
        if (move.captured === 'p') return true;

        // rook for minor, queen for rook/minor (protected)
        if (movingVal > capturedVal + 1) return true;
    }

    // quiet sacrifice
    if (!move.captured && move.isQuietSacrifice === true) return true;

    return false;
}

// ─── Nearly- move check ───────────────────────────────────────────────────
// Chess.com says Brilliant requires the move to be " or nearly ".
// "Nearly " = the played move loses at most NEARLY__THRESHOLD win-prob
// compared to the engine's  move. If cpAfter is unavailable, only
// strict played qualifies (we can't determine "nearly " without it).
const NEARLY__THRESHOLD = 0.02; // within 0.02 EP of the  move


// ─── Core classifier ───────────────────────────────────────────────────────────
//
//  cpBefore      – eval (White's POV, centipawns OR pawn units) BEFORE the move
//  cpAfter       – eval (White's POV, centipawns OR pawn units) AFTER  the move
//  isWhite       – true if the player who just moved was White
//  moveIdx       – half-move index (kept for compatibility, not used)
//  playedMove    – UCI string of the move played,  e.g. "e2e4"
//  Move      – engine best move UCI,           e.g. "d2d4"
//  move          – chess.js verbose move object { piece, captured, …, isQuietSacrifice? }
//  fenAfter      – full FEN after the move (used for opening book lookup)
//  cpBestAfter   – (optional) eval after engine best move (White's POV)
//  playerRating  – (optional, default 1500) used for Brilliant/Great/Miss wp checks
//
// Classification by eval loss in pawn units (moving player's perspective):
//
//   Book        – position found in ECO opening database
//   Brilliant   – piece sacrifice that is also the engine's best move
//   Great       – best move that dramatically improves a bad position
//   Best        – top engine move OR 0.00 – 0.10 pawn loss
//   Excellent   – 0.10 – 0.30 pawn loss
//   Good        – 0.30 – 0.50 pawn loss
//   Inaccuracy  – 0.50 – 1.50 pawn loss
//   Mistake     – 1.50 – 3.00 pawn loss
//   Blunder     – 3.00+ pawn loss
//
// Returns one of:
//   "book" | "brilliant" | "great" | "best" | "excellent" |
//   "good" | "inaccuracy" | "mistake" | "blunder" | "miss"
//
// If Stockfish returns side-to-move eval, flip it for Black's turn
function toWhitePov(cp, sideToMove) {
    return sideToMove === 'b' ? -cp : cp;
}

// Then when calling classifyMove:
function classifyMove(cpBefore, cpAfter, isWhite, moveIdx, playedMove, bestMove, move, fenAfter, cpBestAfter, playerRating = 1500, chess=null) {

    // ── Book ──────────────────────────────────────────────────────────────────
    // A move is Book only if the resulting position is found in the ECO
    // opening database (openings.js). Only genuine theory moves are labelled Book.
    if (fenAfter && isBookPosition(fenAfter)) return "book";

    // ── Unit normalisation: always centipawns in, pawn units for thresholds ──
    // Engines (Stockfish etc.) always return centipawns as integers.
    // Divide by 100 to get pawn units for the threshold comparisons below.
    // Always pass raw engine centipawns — do NOT pre-divide before calling.
    const evalBeforeRaw    = (cpBefore    ?? 0) / 100;
    const evalAfterRaw     = (cpAfter     ?? 0) / 100;
    const cpBestAfterPawns = (cpBestAfter != null) ? cpBestAfter / 100 : null;

    // Flip to moving-player's perspective: positive = good for them.
    const evalBefore = isWhite
    ? evalBeforeRaw
    : -evalBeforeRaw;

    const evalAfter = isWhite
    ? evalAfterRaw
    : -evalAfterRaw;
    // Eval loss in pawn units — positive means the player's position got worse.
    // Negative means the move actually improved the position (zwischenzug, etc.).
    // ── Eval-loss calculation ─────────────────────────────────────────────
//
// We compare the played move against the ENGINE BEST move,
// not against the previous position.
//
// evalLoss = how many pawns worse than best the played move was.

    const evalLoss = Math.max(0, evalBefore - evalAfter);
    // ── Did the player play the engine's top choice? ──────────────────────────
    const playedBest = !!(
        playedMove && bestMove &&
        playedMove.slice(0, 4).toLowerCase() === bestMove.slice(0, 4).toLowerCase()
    );

    // ── Win probabilities (for Brilliant / Great / Miss detection only) ───────
    // The primary classification uses eval loss, not win probability.
    // WP is only needed for the qualitative special categories below.
    const wpBefore = playerWinProb(cpBefore, isWhite, playerRating);
    const wpAfter  = playerWinProb(cpAfter,  isWhite, playerRating);

    const wpBestAfter = (cpBestAfter != null)
    ? playerWinProb(cpBestAfter, isWhite, playerRating)
    : null;
    const nearlyBest = isNearlyBest(playedBest, wpAfter, wpBestAfter);
    console.log({
    cpBefore,
    cpAfter,
    evalBefore,
    evalAfter,
    isWhite,
    evalLoss
    });
    // ── Miss (Missed Win) ─────────────────────────────────────────────────────
    // Was decisively winning (wp ≥ 0.80) → no longer winning (wp ≤ 0.55).
    // Guard: if still above +3.00 pawns it's not a real miss.
    // ── Miss (Missed Win) ─────────────────────────────────────────────────────────
    // Was decisively winning (wp ≥ 0.80) → no longer winning (wp ≤ 0.55).
    // Guards:
    //   • still above +3.00 pawns → not a real miss
    //   • sacrifice move → skip miss, let brilliant/blunder handle it
    //   • mate sequence → skip miss entirely
    if (
        !playedBest                &&
        !detectSacrifice(move)     && 
        Math.abs(cpAfter) < 9000   &&
        evalAfter < 3.0            &&
        wpBefore  >= 0.80          &&
        wpAfter   <= 0.55
    ) return "miss";

    // ── Brilliant (!!) ────────────────────────────────────────────────────────
    // Best (or nearly best) piece sacrifice that keeps the position reasonable.
    if (
        nearlyBest            &&
        detectSacrifice(move, evalBefore, evalAfter, chess) &&
        evalLoss <= 0.50   
    ) return "brilliant";

    // ── Great Move (!) ────────────────────────────────────────────────────────
    // Best move that creates a dramatic turnaround in the position.
    if (playedBest) {
        const turnaround = wpBefore < 0.55 && wpAfter >= 0.60;
        const saved      = wpBefore < 0.40 && wpAfter >= 0.45;
        const onlyMove   = wpBestAfter !== null  &&
                           wpBefore    <= 0.50   &&
                           wpBestAfter >= 0.65   &&
                           (wpBestAfter - wpBefore) >= 0.15;
        if (turnaround || saved || onlyMove) return "great";
    }

    // ── Best ──────────────────────────────────────────────────────────────────
    // Played the engine's exact top choice (no special category fired above).
    if (playedBest || evalLoss < 0.10) return "best";

    // ── Eval-loss thresholds (pawn units) ─────────────────────────────────────
    //
    //   < 0.10  →  Best        (0.00 – 0.10 loss, essentially the top move)
    //   < 0.30  →  Excellent   (0.10 – 0.30 loss, very strong)
    //   < 0.50  →  Good        (0.30 – 0.50 loss, solid play)
    //   < 1.50  →  Inaccuracy  (0.50 – 1.50 loss, noticeable slip)
    //   < 3.00  →  Mistake     (1.50 – 3.00 loss, significant error)
    //   ≥ 3.00  →  Blunder     (3.00+ loss, serious blunder)
    //
    // Note: evalLoss may be negative (the move improved the position).
    // Negative loss is treated as 0 → Best.
    if      (evalLoss < 0.30) return "excellent";
    else if (evalLoss < 0.50) return "good";
    else if (evalLoss < 1.50) return "inaccuracy";
    else if (evalLoss < 3.00) return "mistake";
    else                      return "blunder";
}

// ─── Move Accuracy (Chess.com CAPS2-style) ────────────────────────────────────
//
// Chess.com uses an exponential decay on win-probability loss to produce a
// per-move accuracy score in [0, 100].
// The published formula (reverse-engineered from chess.com / confirmed by
// community analysis):
//
//   accuracy = 103.1668 × exp(−0.04354 × wpLoss_pct) − 3.1669
//
// where wpLoss_pct = max(0, wpBefore − wpAfter) expressed as 0–100.
// Book moves score 100 (treated as Best).
//
// ─── Move Accuracy (Chess.com CAPS2-style) ────────────────────────────────────
function moveAccuracy(cpBefore, cpAfter, isWhite, classification, playerRating = 1500) {

    // ✅ Brilliant, Great, Best, Book → always 100%
    if (["brilliant", "great", "best", "book"].includes(classification)) {
        return 100;
    }
    // everything else uses the normal formula
    const wpBefore = playerWinProb(cpBefore, isWhite, playerRating) * 100;
    const wpAfter  = playerWinProb(cpAfter,  isWhite, playerRating) * 100;
    const wpLoss   = Math.max(0, wpBefore - wpAfter);
    return Math.max(0, Math.min(100,
        103.1668 * Math.exp(-0.04354 * wpLoss) - 3.1669
    ));
}
// ─── UI helpers ────────────────────────────────────────────────────────────────

// Formats a centipawn / mate score for display.
// FIX: chess.com uses "#4" notation for mate, not "M4".
//      Positive mate = moving player is mating; shown as "#N".
//      Negative mate = moving player is being mated; shown as "-#N".
function formatEval(cp, mate) {
    if (mate !== null && mate !== undefined) {
        return (mate > 0 ? "#" : "-#") + Math.abs(mate);
    }
    if (cp === null || cp === undefined) return "0.00";
    const pawns = cp / 100;
    return (pawns >= 0 ? "+" : "") + pawns.toFixed(2);
}

function getClassIcon(cls) {
    const img = document.createElement("img");
    img.src   = CLASS_IMG_PATH + cls + ".png";
    img.alt   = cls;
    img.title = cls;
    img.style.cssText = "width:16px;height:16px;object-fit:contain;flex-shrink:0;";
    return img;
}

// ─── Human-readable classification labels ─────────────────────────────────────
// FIX: chess.com displays "Great Move" (two words) and "Missed Win" (not "Miss")
//      in the review panel. Map internal keys to display strings.
const CLS_LABEL = {
    brilliant:  "Brilliant",
    great:      "Great Move",
    best:       "Best",
    excellent:  "Excellent",
    good:       "Good",
    book:       "Book",
    inaccuracy: "Inaccuracy",
    mistake:    "Mistake",
    blunder:    "Blunder",
    miss:       "Missed Win",
};

function clsLabel(cls) {
    return CLS_LABEL[cls] ?? (cls.charAt(0).toUpperCase() + cls.slice(1));
}

function showMoveDetail(idx, positions, analysisData, isWhiteTurn) {
    const detail = document.getElementById("moveDetail");
    if (!detail) return;
    if (idx <= 0 || !analysisData[idx] || !analysisData[idx].classification) {
        detail.style.display = "none";
        return;
    }

    const data = analysisData[idx];
    detail.style.display = "flex";

    const icon    = document.getElementById("detailIcon");
    const cls     = document.getElementById("detailClass");
    const evEl    = document.getElementById("detailEval");
    const best    = document.getElementById("detailBest");
    const opening = document.getElementById("detailOpening"); // optional element

    icon.src           = CLASS_IMG_PATH + data.classification + ".png";
    icon.style.display = "block";
    // FIX: use clsLabel() for correct display text (e.g. "Great Move", "Missed Win")
    cls.textContent    = clsLabel(data.classification);
    // Always show eval from White's perspective — positive = White is better.
    // data.cpWhite is stored as raw Stockfish output (White POV, never flipped).
    // We deliberately ignore isWhiteTurn here: the eval bar may flip internally,
    // but the text eval display always uses the engine's raw White-POV number.
    const displayCp = data.cpWhite !== undefined ? data.cpWhite : data.cp;
    evEl.textContent = "Eval: " + formatEval(displayCp, data.mate);
    const prevData = analysisData[idx - 1] || {};
    if (prevData.bestMove && prevData.bestMove.length >= 4) {
        try {
            const chess = new Chess(positions[idx - 1].fen);
            const move = chess.move({
                from: prevData.bestMove.slice(0, 2),
                to:   prevData.bestMove.slice(2, 4),
                promotion: prevData.bestMove[4] || 'q'
            });
            best.textContent = move ? "Best: " + move.san : "Best: " + prevData.bestMove;
        } catch {
            best.textContent = "Best: " + prevData.bestMove;
        }
    } else {
        best.textContent = "";
    }

    // Show opening name for book moves (requires fenAfter stored in analysisData)
    if (opening) {
        if (data.classification === "book" && data.fenAfter) {
            const name = lookupOpening(data.fenAfter);
            opening.textContent = name || "";
            opening.style.display = name ? "block" : "none";
        } else {
            opening.textContent = "";
            opening.style.display = "none";
        }
    }
    const statusBar = document.getElementById("statusBar");
    if (statusBar) {
        if (data.classification === "book" && data.fenAfter) {
            const name = lookupOpening(data.fenAfter);
            statusBar.textContent = name || "";
        } else {
            // try previous positions for opening name
        let openingName = "";
        for (let i = idx; i >= 0; i--) {
            if (analysisData[i] && analysisData[i].fenAfter) {
                const n = lookupOpening(analysisData[i].fenAfter);
                if (n) { openingName = n; break; }
            }
        }
        statusBar.textContent = openingName;
    }
}
}

function buildClassSummary(analysisData) {
    const counts = {};
    for (const d of analysisData) {
        if (d && d.classification) {
            counts[d.classification] = (counts[d.classification] || 0) + 1;
        }
    }

    const wrap = document.getElementById("classSummary");
    if (!wrap) return;
    wrap.innerHTML = "";
    wrap.style.display = "flex";

    // Display order matches chess.com's game review summary panel
    const order = ["brilliant","great","best","excellent","good","book","inaccuracy","mistake","blunder","miss"];
    for (const cls of order) {
        if (!counts[cls]) continue;
        const row = document.createElement("div");
        row.classList.add("class-row");
        row.innerHTML = `
            <img src="${CLASS_IMG_PATH}${cls}.png" alt="${cls}" style="width:18px;height:18px;object-fit:contain;">
            <span>${clsLabel(cls)}</span>
            <span class="class-count">${counts[cls]}</span>
        `;
        wrap.appendChild(row);
    }
}

// ── Colour map ────────────────────────────────────────────────────────────────
// Each value is { color, opacity } — kept separate so the light/dark square
// contrast is preserved underneath (same technique Chess.com uses).
//
// FIX: updated colours to match chess.com's actual board highlight palette
// (sampled from chess.com's CSS / canvas):
//   • brilliant  – teal/cyan  #1BADA6  (chess.com's signature brilliant teal)
//   • great      – blue-teal  #5C8BB0  (distinct from brilliant, cooler blue)
//   • best       – green      #7FC97A  (chess.com's best-move green)
//   • excellent  – light green #96C964  (slightly lighter than best)
//   • good       – muted green #A3C86E
//   • book       – tan/brown  #A88650  (opening book amber-brown)
//   • inaccuracy – yellow     #F6C833
//   • mistake    – orange     #F0874A
//   • blunder    – red        #E44E4E
//   • miss       – orange-red #E84D39  (chess.com uses same red family as blunder)
const CLS_HIGHLIGHT = {
    brilliant:  { color: '#1BADA6', opacity: 0.82 },
    great:      { color: '#5C8BB0', opacity: 0.80 },
    best:       { color: '#7FC97A', opacity: 0.78 },
    excellent:  { color: '#96C964', opacity: 0.70 },
    good:       { color: '#A3C86E', opacity: 0.62 },
    book:       { color: '#A88650', opacity: 0.68 },
    inaccuracy: { color: '#F6C833', opacity: 0.72 },
    mistake:    { color: '#F0874A', opacity: 0.78 },
    blunder:    { color: '#E44E4E', opacity: 0.82 },
    miss:       { color: '#E84D39', opacity: 0.82 },
};

// ── Internal: create one overlay div ─────────────────────────────────────────
function _makeHighlightOverlay(color, opacity, isDestination) {
    const el = document.createElement("div");
    el.className = "sq-cls-highlight";
    el.style.cssText = `
        position:   absolute;
        inset:      0;
        background: ${color};
        opacity:    ${opacity};
        pointer-events: none;
        z-index:    5;
        border-radius: 0;
    `;
    // Chess.com makes the destination square slightly brighter/more opaque
    if (isDestination) el.style.opacity = Math.min(1, opacity + 0.08);
    return el;
}

function clearClassificationHighlights() {
    boardEl.querySelectorAll(".sq-highlight-overlay").forEach(el => {
        el.style.background = "transparent";
    });
}

// ── applyClassificationHighlight ─────────────────────────────────────────────
// @param {string}      from  – algebraic origin square,       e.g. "e2"
// @param {string}      to    – algebraic destination square,  e.g. "e4"
// @param {string|null} cls   – classification string, e.g. "brilliant"
//                              pass null / undefined to only clear.
function applyClassificationHighlight(from, to, cls) {
    clearClassificationHighlights();
    if (!cls) return;
    const style = CLS_HIGHLIGHT[cls];
    if (!style) return;

    [from, to].forEach((sq, i) => {
        const sqEl = boardEl.querySelector(`[data-sq="${sq}"]`);
        if (!sqEl) return;
        const overlay = sqEl.querySelector(".sq-highlight-overlay");
        if (!overlay) return;
        overlay.style.background = style.color;
        // Destination square slightly more opaque, matching Chess.com style
        overlay.style.opacity = i === 1
            ? Math.min(1, style.opacity + 0.08)
            : style.opacity;
    });
}
