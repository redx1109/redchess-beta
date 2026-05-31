/* ══════════════════════════════════════════════════════════════
   RED CHESS — EVENTS  (all event listeners + coord labels)
   ══════════════════════════════════════════════════════════════ */

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
});

// ─── Selection screen: PGN paste ─────────────────────────────────────────────

document.getElementById("loadPgnBtn").addEventListener("click", () => {
    const pgn = document.getElementById("pgnInput").value.trim();
    if (!pgn) return;
    fetchedGames = [];
    startGame(pgn);
});

// ─── Selection screen: fetch buttons ─────────────────────────────────────────

document.getElementById("fetchLichessBtn").addEventListener("click", async () => {
    const user = document.getElementById("lichessUser").value.trim();
    if (!user) { setSelStatus("Enter a Lichess username first"); return; }
    const btn = document.getElementById("fetchLichessBtn");
    btn.disabled = true;
    setSelStatus("Fetching from Lichess…", true);
    try {
        const games = await fetchLichessGames(user);
        if (!games.length) {
            setSelStatus(`No games found for "${user}" — check spelling`);
            btn.disabled = false; return;
        }
        fetchedGames = games;
        setSelStatus("");
        buildGamesScreen(games, user, "lichess");
    } catch (e) {
        console.error("Lichess fetch error:", e);
        setSelStatus("⚠ " + (e.message || "Network error — try again"));
    }
    btn.disabled = false;
});

document.getElementById("fetchChesscomBtn").addEventListener("click", async () => {
    const user = document.getElementById("chesscomUser").value.trim();
    if (!user) { setSelStatus("Enter a Chess.com username first"); return; }
    const btn = document.getElementById("fetchChesscomBtn");
    btn.disabled = true;
    setSelStatus("Fetching from Chess.com…", true);
    try {
        const games = await fetchChessComGames(user);
        if (!games.length) {
            setSelStatus(`No games found for "${user}" — check spelling or try again`);
            btn.disabled = false; return;
        }
        fetchedGames = games;
        setSelStatus("");
        buildGamesScreen(games, user, "chesscom");
    } catch (e) {
        console.error("Chess.com fetch error:", e);
        setSelStatus("⚠ " + (e.message || "Network error — try again"));
    }
    btn.disabled = false;
});

document.getElementById("lichessUser").addEventListener("keydown",
    e => { if (e.key === "Enter") document.getElementById("fetchLichessBtn").click(); });
document.getElementById("chesscomUser").addEventListener("keydown",
    e => { if (e.key === "Enter") document.getElementById("fetchChesscomBtn").click(); });

// ─── Screen navigation buttons ────────────────────────────────────────────────

document.getElementById("gamesBackBtn").addEventListener("click", () => showScreen("screenSelection"));
document.getElementById("statsBackBtn").addEventListener("click", () => {
    isAnalysing = false;
    fetchedGames.length ? showScreen("screenGames") : showScreen("screenSelection");
});

document.getElementById("statsToBoardBtn").addEventListener("click", () => {
    showScreen("screenAnalysis");
    goToMove(currentIdx || 0);
});

document.getElementById("boardToStatsBtn").addEventListener("click", () => showScreen("screenStats"));

// ─── Board navigation buttons ─────────────────────────────────────────────────

document.getElementById("navStart").addEventListener("click", () => goToMove(0));
document.getElementById("navEnd").addEventListener("click",   () => goToMove(positions.length - 1));
document.getElementById("navPrev").addEventListener("click",  () => goToMove(currentIdx - 1));
document.getElementById("navNext").addEventListener("click",  () => goToMove(currentIdx + 1));

// ─── Keyboard navigation (board screen only) ──────────────────────────────────

document.addEventListener("keydown", e => {
    if (document.getElementById("screenAnalysis").classList.contains("hidden")) return;
    if (e.key === "ArrowLeft")  goToMove(currentIdx - 1);
    if (e.key === "ArrowRight") goToMove(currentIdx + 1);
    if (e.key === "ArrowUp")    goToMove(0);
    if (e.key === "ArrowDown")  goToMove(positions.length - 1);
});
