// ─── username-popup.js ─────────────────────────────────────────────────────────
// Handles: splash username popup, persistent storage, player name bars
// around the board. Include this BEFORE game.js on every game page.
// ──────────────────────────────────────────────────────────────────────────────

(function () {
    'use strict';

    // ── Storage helpers ───────────────────────────────────────────────────────────

    function getUsername() {
        return localStorage.getItem('chessUsername') || '';
    }

    function setUsername(name) {
        const v = (name || '').trim().slice(0, 20);
        if (v) localStorage.setItem('chessUsername', v);
        return v;
    }

    // ── Bot name helper ───────────────────────────────────────────────────────────

    function getBotName() {
        try {
            const cfg = JSON.parse(localStorage.getItem('botSettings') || 'null');
            if (cfg && cfg.active) return cfg.name || cfg.personality || 'Computer';
        } catch (e) {}
        return null; // not a bot game
    }

    // ── Styles ────────────────────────────────────────────────────────────────────

    function injectStyles() {
        if (document.getElementById('_usernameStyles')) return;
        const st = document.createElement('style');
        st.id = '_usernameStyles';
        st.textContent = `
            /* ── Splash overlay ── */
            #usernameOverlay {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.75);
                display: flex; align-items: center; justify-content: center;
                z-index: 10000;
                animation: _uFadeIn 0.18s ease;
            }
            @keyframes _uFadeIn { from { opacity:0 } to { opacity:1 } }

            #usernameBox {
                position: relative;
                background: #181818;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 18px;
                padding: 38px 32px 28px;
                width: min(320px, 90vw);
                box-shadow: 0 28px 80px rgba(0,0,0,0.9);
                animation: _uPop 0.22s cubic-bezier(.2,1.4,.35,1);
            }
            @keyframes _uPop {
                from { transform: scale(.82); opacity: 0; }
                to   { transform: scale(1);   opacity: 1; }
            }

            #usernameClose {
                position: absolute; top: 14px; right: 16px;
                background: none; border: none;
                color: rgba(255,255,255,0.3);
                font-size: 19px; line-height: 1;
                cursor: pointer; padding: 4px;
                transition: color 0.15s;
            }
            #usernameClose:hover { color: rgba(255,255,255,0.85); }

            #usernameIcon {
                text-align: center;
                font-size: 38px;
                margin-bottom: 10px;
                filter: drop-shadow(0 2px 6px rgba(192,57,43,0.4));
            }
            #usernameTitle {
                text-align: center;
                font-family: 'Cinzel', 'Georgia', serif;
                color: #fff;
                font-size: 21px; font-weight: 700;
                letter-spacing: 0.05em;
                margin-bottom: 5px;
            }
            #usernameSub {
                text-align: center;
                color: rgba(255,255,255,0.35);
                font-size: 12px;
                font-family: sans-serif;
                margin-bottom: 24px;
            }

            #usernameInput {
                width: 100%; box-sizing: border-box;
                background: #252525;
                border: 1.5px solid rgba(255,255,255,0.1);
                border-radius: 10px;
                color: #fff; font-size: 15px;
                padding: 11px 14px;
                outline: none;
                font-family: sans-serif;
                margin-bottom: 13px;
                transition: border-color 0.2s;
            }
            #usernameInput:focus  { border-color: rgba(192,57,43,0.65); }
            #usernameInput::placeholder { color: rgba(255,255,255,0.22); }

            #usernameConfirm {
                width: 100%;
                background: #c0392b;
                border: none; border-radius: 10px;
                color: #fff; font-size: 14px; font-weight: 700;
                padding: 12px; cursor: pointer;
                font-family: sans-serif;
                letter-spacing: 0.05em;
                transition: background 0.15s, transform 0.1s;
            }
            #usernameConfirm:hover  { background: #e74c3c; transform: translateY(-1px); }
            #usernameConfirm:active { transform: translateY(0); }

            /* ── Player name bars around the board ── */
            .player-bar {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 7px 2px;
                font-family: 'Cinzel', 'Georgia', serif;
                font-size: 14px;
                font-weight: 600;
                letter-spacing: 0.04em;
                user-select: none;
                min-height: 32px;
            }
            #playerBarTop    { color: rgba(255,255,255,0.48); }
            #playerBarBottom { color: rgba(255,255,255,0.92); }

            .p-dot {
                width: 11px; height: 11px;
                border-radius: 50%;
                display: inline-block;
                flex-shrink: 0;
            }
            .p-dot-white {
                background: #f0d9b5;
                border: 1.5px solid rgba(255,255,255,0.35);
            }
            .p-dot-black {
                background: #2a2a2a;
                border: 1.5px solid rgba(255,255,255,0.18);
            }
        `;
        document.head.appendChild(st);
    }

    // ── Splash popup ──────────────────────────────────────────────────────────────

    function showUsernamePopup(onDone) {
        injectStyles();

        const overlay = document.createElement('div');
        overlay.id = 'usernameOverlay';
        overlay.innerHTML = `
            <div id="usernameBox">
                <button id="usernameClose" title="Skip">✕</button>
                <div id="usernameIcon">♟</div>
                <div id="usernameTitle">Enter Username</div>
                <div id="usernameSub">Let everyone know who they're up against 😏</div>
                <input id="usernameInput" type="text" maxlength="20"
                    placeholder="Your name..."
                    autocomplete="off"
                    value="${getUsername()}" />
                <button id="usernameConfirm">Let's Play ♟</button>
            </div>
        `;
        document.body.appendChild(overlay);

        const input   = overlay.querySelector('#usernameInput');
        const confirm = overlay.querySelector('#usernameConfirm');
        const close   = overlay.querySelector('#usernameClose');

        input.focus();
        input.select();

        const dismiss = () => {
            overlay.style.animation = '_uFadeIn 0.15s ease reverse';
            setTimeout(() => { overlay.remove(); if (onDone) onDone(); }, 140);
        };

        const save = async () => {
    const name = input.value.trim();
    if (!name || name.length < 2) {
        input.style.borderColor = 'rgba(192,57,43,0.9)';
        return;
    }

    confirm.disabled = true;
    confirm.textContent = 'Checking…';

    try {
        const SERVER = 'https://beta.redchess.workers.dev'; // ← your actual server URL

        // Check availability
        const checkRes  = await fetch(`${SERVER}/api/username/check?name=${encodeURIComponent(name)}`);
        const checkData = await checkRes.json();

        if (!checkData.available) {
            input.style.borderColor = 'rgba(192,57,43,0.9)';
            confirm.textContent = 'Username taken!';
            confirm.disabled = false;
            setTimeout(() => { confirm.textContent = "Let's Play ♟"; }, 2000);
            return;
        }

        // Register it
        await fetch(`${SERVER}/api/username/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: name })
        });

        setUsername(name);
        dismiss();
    } catch (err) {
        confirm.textContent = 'Error — try again';
        confirm.disabled = false;
        setTimeout(() => { confirm.textContent = "Let's Play ♟"; }, 2000);
    }
};

        close.addEventListener('click', dismiss);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
        confirm.addEventListener('click', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    }

    // ── Player bars (injected around the chess board) ─────────────────────────────

    function injectPlayerBars() {
        if (document.getElementById('playerBarBottom')) return;
        const board = document.getElementById('board');
        if (!board) return;

        // In bot mode, opponentNameplate already shows the bot above the board —
        // skip the top bar entirely to avoid the duplicate name.
        if (!window._botActive) {
            if (!document.getElementById('playerBarTop')) {
                const topBar = document.createElement('div');
                topBar.id = 'playerBarTop';
                topBar.className = 'player-bar';
                board.parentNode.insertBefore(topBar, board);
            }
        }

        const bottomBar = document.createElement('div');
        bottomBar.id = 'playerBarBottom';
        bottomBar.className = 'player-bar';
        board.parentNode.insertBefore(bottomBar, board.nextSibling);
    }

    function updatePlayerBars() {
        const topBar    = document.getElementById('playerBarTop');
        const bottomBar = document.getElementById('playerBarBottom');
        if (!bottomBar) return;

        const username    = getUsername() || 'You';
        const botName     = getBotName();
        const flipped     = window._flipped || false;
        const bottomColor = flipped ? 'b' : 'w';
        const topColor    = flipped ? 'w' : 'b';
        const dotClass    = (c) => `p-dot ${c === 'w' ? 'p-dot-white' : 'p-dot-black'}`;

        let bottomName, topName;

        if (botName) {
            const playerCol = (() => {
                try {
                    const cfg = JSON.parse(localStorage.getItem('botSettings') || 'null');
                    return (cfg && cfg.playerColor) || 'w';
                } catch(e) { return 'w'; }
            })();
            bottomName = bottomColor === playerCol ? username : botName;
            topName    = topColor    === playerCol ? username : botName;
        } else {
    // ✅ Check if this is a Socket.io online game
    const onlineRoom = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    const opponentName = onlineRoom.opponentName || 'Opponent';
    const myColor = onlineRoom.myColor || 'w';
    bottomName = bottomColor === myColor ? username : opponentName;
    topName    = topColor    === myColor ? username : opponentName;
}

        bottomBar.innerHTML = `<span class="${dotClass(bottomColor)}"></span>${bottomName}`;
        if (topBar) topBar.innerHTML = `<span class="${dotClass(topColor)}"></span>${topName}`;
    }

    // ── Public API ────────────────────────────────────────────────────────────────

    window.getUsername       = getUsername;
    window.setUsername       = setUsername;
    window.getBotName        = getBotName;
    window.showUsernamePopup = showUsernamePopup;
    window.updatePlayerBars  = updatePlayerBars;

    // Auto-inject bars as soon as DOM is ready
    function init() {
        injectStyles();
        injectPlayerBars();
        updatePlayerBars();

        // Show username popup if no username saved yet.
        // On homepage the splash handles this — skip if splash element exists.
        if (!getUsername() && !document.getElementById('splash')) {
            showUsernamePopup(updatePlayerBars);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
