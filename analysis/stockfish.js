/* ══════════════════════════════════════════════════════════════
   RED CHESS — STOCKFISH  (engine wrapper)
   ══════════════════════════════════════════════════════════════ */
let stockfish = null;
let sfReady   = false;
const SF_DEPTH = 15;

function initStockfish() {
    try {
        stockfish = new Worker("../engine/stockfish-18.js");
        console.log("Stockfish worker created, waiting for engine...");
        stockfish.onmessage = e => {
            console.log("SF message:", e.data);
            if (e.data === "readyok") { sfReady = true; console.log("Stockfish READY ✅"); }
        };
        stockfish.onerror = err => console.error("Stockfish worker failed to load:", err.message || err.type || "unknown error — check COOP/COEP headers", err);
        stockfish.postMessage("uci");
        stockfish.postMessage("isready");
    } catch (err) {
        console.warn("Stockfish unavailable:", err);
    }
}

function evalPosition(fen, onLiveEval) {
    return new Promise(resolve => {
        if (!stockfish || !sfReady) { resolve(null); return; }

        let best = { depth: -1, cp: null, mate: null };
        const orig = stockfish.onmessage;
        const isWhiteTurn = fen.split(" ")[1] === "w";

        stockfish.onmessage = e => {
            const msg = e.data;
            if (typeof msg !== "string") return;

            if (msg.startsWith("info") && msg.includes("score")) {
                const d  = (msg.match(/\bdepth (\d+)/)       || [])[1];
                const cp = (msg.match(/score cp (-?\d+)/)    || [])[1];
                const mt = (msg.match(/score mate (-?\d+)/)  || [])[1];

                if (+d > best.depth) {
                    best.depth = +d;
                    if (cp !== undefined) best.cp   = +cp;
                    if (mt !== undefined) best.mate = +mt;

                    if (onLiveEval) {
                        onLiveEval(best.cp, best.mate, isWhiteTurn, best.depth);
                    }
                }
            }

            if (msg.startsWith("bestmove")) {
                stockfish.onmessage = orig;
                resolve({ cp: best.cp, mate: best.mate, bestMove: msg.split(" ")[1] });
            }
        };

        stockfish.postMessage("stop");
        stockfish.postMessage("position fen " + fen);
        stockfish.postMessage(`go depth ${SF_DEPTH}`);
    });
}