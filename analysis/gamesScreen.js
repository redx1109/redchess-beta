/* ══════════════════════════════════════════════════════════════
   RED CHESS — GAMES SCREEN  (list + summary grid)
   ══════════════════════════════════════════════════════════════ */

// ─── HTML escape helper ───────────────────────────────────────────────────────

function esc(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Games list screen ────────────────────────────────────────────────────────

function buildGamesScreen(games, username, source) {
    localStorage.setItem("chessUsername", username);
    const displaySource = source === "lichess" ? "Lichess" : "Chess.com";
    document.getElementById("gamesUserLabel").textContent  = `@${username} · ${displaySource}`;
    document.getElementById("gamesCountLabel").textContent = `${games.length} game${games.length !== 1 ? "s" : ""}`;

    const grid = document.getElementById("gamesList");
    grid.innerHTML = "";

    games.forEach(game => {
        let white, black, result, pgn, timeClass;

        if (source === "lichess") {
            white     = game.players?.white?.user?.name || game.players?.white?.name || "?";
            black     = game.players?.black?.user?.name || game.players?.black?.name || "?";
            result    = game.winner ? (game.winner === "white" ? "1-0" : "0-1") : "½-½";
            pgn       = game.pgn;
            timeClass = game.speed || game.perf || "";
        } else {
            // Chess.com — parse PGN headers
            const tag = k => {
                const l = (game.pgn || "").split("\n").find(x => x.startsWith(`[${k} `)) || "";
                return (l.match(/\[.+ "(.+)"\]/) || [])[1] || "?";
            };
            white     = tag("White");
            black     = tag("Black");
            result    = tag("Result");
            timeClass = game.time_class || game.rules || "";
            pgn       = game.pgn;
        }

        if (!pgn) return; // skip games without PGN

        const rc = result === "1-0" ? "ww" : result === "0-1" ? "bw" : "";
        const card = document.createElement("div");
        card.className = "game-card";
        card.innerHTML = `
            <div class="gc-players">
                <div class="gc-player"><span class="gc-pip white"></span><span>${esc(white)}</span></div>
                <div class="gc-divider"></div>
                <div class="gc-player"><span class="gc-pip black"></span><span>${esc(black)}</span></div>
            </div>
            <div class="gc-meta">
                <span class="gc-result ${rc}">${esc(result)}</span>
                <span>${esc(timeClass)}</span>
            </div>
            <div class="gc-cta">Analyse →</div>
        `;
        card.addEventListener("click", () => startGame(pgn));
        grid.appendChild(card);
    });

    showScreen("screenGames");
}

// ─── Move summary grid ────────────────────────────────────────────────────────

// Paste this inside (or replace) your buildSummaryGrid function.
// Every classification always appears — shows "—" when count is 0.

function buildSummaryGrid(analysisData, positions) {
    // Tally counts per side using cls.name as the key
    const wCount = {}, bCount = {};
    CLASSIFICATIONS.forEach(c => { wCount[c.name] = 0; bCount[c.name] = 0; });

    for (let i = 1; i < analysisData.length; i++) {
        const cls = analysisData[i]?.classification;
        if (!cls || !(cls in wCount)) continue;
        if (positions[i].color === 'w') wCount[cls]++;
        else                            bCount[cls]++;
    }

    const grid = document.getElementById('summaryGrid');
    grid.innerHTML = '';

    CLASSIFICATIONS.forEach(({ name, label }) => {
        const w = wCount[name];
        const b = bCount[name];

        const wCell = document.createElement('div');
        wCell.className = 'sg-wcount';
        wCell.textContent = w > 0 ? w : '—';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'sg-label';
        labelDiv.innerHTML = `<img src="move_classification/${name}.png" alt="${name}"><span>${label}</span>`;

        const bCell = document.createElement('div');
        bCell.className = 'sg-bcount';
        bCell.textContent = b > 0 ? b : '—';

        grid.appendChild(wCell);
        grid.appendChild(labelDiv);
        grid.appendChild(bCell);
    });
}
