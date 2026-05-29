/* ══════════════════════════════════════════════════════════════
   RED CHESS — PGN  (parsing + fetch helpers)
   ══════════════════════════════════════════════════════════════ */

// ─── PGN parsing ─────────────────────────────────────────────────────────────

function parsePGN(pgn) {
    try {
        const cleaned = pgn
            .replace(/\{[^}]*\}/g, "")
            .replace(/\$\d+/g, "")
            .replace(/\d+\.\.\./g, "")
            .trim();
        const chess = new Chess();
        if (!chess.load_pgn(cleaned)) return null;
        const headers = chess.header();
        const history = chess.history({ verbose: true });
        const game    = new Chess();
        const pos = [{ fen: game.fen(), san: null, color: null, move: null }];
        for (const mv of history) {
            if (!game.move(mv.san)) break;
            pos.push({ fen: game.fen(), san: mv.san, color: mv.color, move: mv });
        }
        return { positions: pos, headers };
    } catch (err) {
        console.error("PGN parse error:", err);
        return null;
    }
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchLichessGames(username) {
    const r = await fetch(
        `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=20&pgnInJson=true`,
        { headers: { Accept: "application/x-ndjson" } }
    );
    if (!r.ok) throw new Error(`Lichess API error ${r.status} — check username`);
    const text = await r.text();
    const games = [];
    for (const line of text.trim().split("\n")) {
        if (!line.trim()) continue;
        try {
            const g = JSON.parse(line);
            if (g.pgn) games.push(g);
        } catch { /* skip malformed lines */ }
    }
    return games;
}

async function fetchChessComGames(username) {
    // Try up to 3 recent months until we find games
    const now = new Date();
    for (let offset = 0; offset < 3; offset++) {
        const d     = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const year  = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const url   = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${year}/${month}`;
        const r     = await fetch(url);
        if (!r.ok) {
            if (r.status === 404 && offset === 0) {
                throw new Error(`Chess.com user "${username}" not found (404)`);
            }
            continue; // try previous month
        }
        const data  = await r.json();
        const games = data.games || [];
        if (games.length > 0) return games.slice(-20).reverse();
    }
    return []; // no games in last 3 months
}