// ─── online.js ───────────────────────────────────────────────────────────────
// Include on every page AFTER username-popup.js
// Handles: server connection, unique username check, matchmaking UI
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Config — change this to your server URL ──────────────────────────────
  const SERVER_URL = 'https://redchess-beta.up.railway.app'; // 👈 change to your deployed server URL

  // ── Load Socket.io client from server ────────────────────────────────────
  initSocket();
  let socket;

  function initSocket() {
    socket = io(SERVER_URL, { autoConnect: false });

    socket.on('connect', () => {
      const username = window.getUsername?.();
      if (username) socket.emit('player:online', { username });
    });

    // ── Incoming match request ──────────────────────────────────────────────
    socket.on('match:incoming', ({ from }) => {
      showMatchRequest(from);
    });

    // ── Match was declined ──────────────────────────────────────────────────
    socket.on('match:declined', ({ by }) => {
      alert(`${by} declined your match request.`);
    });

    // ── Match request error ─────────────────────────────────────────────────
    socket.on('match:error', ({ message }) => {
      alert(message);
    });

    // ── Queued — waiting for opponent ───────────────────────────────────────
    socket.on('queue:waiting', () => {
      console.log('⏳ In matchmaking queue, waiting...');
      // You can update UI here to show "Searching for opponent..."
    });

    // ── Game is starting! ───────────────────────────────────────────────────
    socket.on('game:start', ({ roomId, white, black }) => {
      console.log(`🎮 Game starting! Room: ${roomId}, White: ${white}, Black: ${black}`);
      // Save room info and redirect to game page
      localStorage.setItem('onlineRoom', JSON.stringify({ roomId, white, black }));
      window.location.href = '/play/game.html'; // 👈 adjust to your game page path
    });

    socket.connect();
  }

  // ─── Username registration with uniqueness check ──────────────────────────
  // Call this instead of the plain showUsernamePopup on online-enabled pages.
  // It patches the confirm button to verify uniqueness with the server first.

  async function checkUsernameAvailable(name) {
    try {
      const res  = await fetch(`${SERVER_URL}/api/username/check?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      return data;
    } catch (e) {
      return { available: true }; // fail open if server is unreachable
    }
  }

  async function registerUsername(name) {
    try {
      const res  = await fetch(`${SERVER_URL}/api/username/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: name })
      });
      return await res.json();
    } catch (e) {
      return { ok: true }; // fail open
    }
  }

  // Patch the username popup confirm button to check uniqueness
  function patchUsernamePopup() {
    const confirmBtn = document.getElementById('usernameConfirm');
    const input      = document.getElementById('usernameInput');
    if (!confirmBtn || !input) return;

    confirmBtn.addEventListener('click', async (e) => {
      e.stopImmediatePropagation(); // prevent original handler from firing first

      const name = input.value.trim();
      if (!name) return;

      confirmBtn.disabled    = true;
      confirmBtn.textContent = 'Checking...';

      const { available, error } = await checkUsernameAvailable(name);

      if (!available) {
        confirmBtn.disabled    = false;
        confirmBtn.textContent = "Let's Play ♟";
        // Show error under input
        let errEl = document.getElementById('_usernameError');
        if (!errEl) {
          errEl    = document.createElement('div');
          errEl.id = '_usernameError';
          errEl.style.cssText = 'color:#e74c3c;font-size:12px;text-align:center;margin-top:-8px;margin-bottom:10px;font-family:sans-serif;';
          input.insertAdjacentElement('afterend', errEl);
        }
        errEl.textContent = error || '❌ Username already taken, try another!';
        return;
      }

      await registerUsername(name);
      window.setUsername?.(name);
      // Let the original dismiss logic run
      confirmBtn.disabled    = false;
      confirmBtn.textContent = "Let's Play ♟";
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: false }));

      // Connect socket with the new username
      if (socket) {
        socket.emit('player:online', { username: name });
      }
    }, true); // capture phase — runs before the original listener
  }

  // Watch for the popup to appear in DOM, then patch it
  const observer = new MutationObserver(() => {
    if (document.getElementById('usernameConfirm')) {
      patchUsernamePopup();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Search player by username ────────────────────────────────────────────
  window.searchPlayer = async function (query) {
    if (!query || query.length < 2) return [];
    try {
      const res  = await fetch(`${SERVER_URL}/api/players/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.players || [];
    } catch (e) { return []; }
  };

  // ─── Send match request ───────────────────────────────────────────────────
  window.sendMatchRequest = function (toUsername) {
    socket?.emit('match:request', { to: toUsername });
  };

  // ─── Random matchmaking ───────────────────────────────────────────────────
  window.joinMatchmaking = function () {
    socket?.emit('queue:join');
  };

  window.leaveMatchmaking = function () {
    socket?.emit('queue:leave');
  };

  // ─── In-game move sync ────────────────────────────────────────────────────
  window.sendOnlineMove = function (move, fen) {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    socket?.emit('game:move', { roomId: room.roomId, move, fen });
  };

  window.onOnlineMove = function (callback) {
    socket?.on('game:move', ({ move, fen }) => callback(move, fen));
  };

  window.resignOnlineGame = function () {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    socket?.emit('game:resign', { roomId: room.roomId });
  };

  // ─── Incoming match request popup ────────────────────────────────────────
  function showMatchRequest(from) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:2rem;right:2rem;
      background:#181818;border:1px solid rgba(201,168,76,.35);
      border-radius:14px;padding:18px 20px;
      font-family:'Cinzel',serif;color:#fff;
      z-index:10001;box-shadow:0 12px 40px rgba(0,0,0,.8);
      animation:_uPop .22s cubic-bezier(.2,1.4,.35,1);
      max-width:260px;
    `;
    el.innerHTML = `
      <div style="font-size:13px;color:rgba(201,168,76,.8);margin-bottom:6px;">Match Request</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:14px;">⚔️ ${from} wants to play!</div>
      <div style="display:flex;gap:8px;">
        <button id="_acceptBtn" style="flex:1;background:#c0392b;border:none;border-radius:8px;color:#fff;padding:9px;cursor:pointer;font-weight:700;font-size:13px;">Accept</button>
        <button id="_declineBtn" style="flex:1;background:#252525;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;padding:9px;cursor:pointer;font-size:13px;">Decline</button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('#_acceptBtn').onclick  = () => { socket?.emit('match:accept', { from }); el.remove(); };
    el.querySelector('#_declineBtn').onclick = () => { socket?.emit('match:decline', { from }); el.remove(); };

    // Auto-dismiss after 30s
    setTimeout(() => el.remove(), 30000);
  }

  window._redChessOnline = { socket: () => socket };

})();
