// ─── online.js ───────────────────────────────────────────────────────────────
let socket;
(function () {
  'use strict';
  let _onlineMoveCallback = null;

  // FIX 1: SERVER_URL is now at the top of the IIFE scope so every function
  // inside — including getOnlinePlayers — can access it. Previously
  // getOnlinePlayers was defined OUTSIDE the IIFE and threw a ReferenceError
  // because SERVER_URL was not in its scope.
  const SERVER_URL = 'https://redchess-beta.up.railway.app';

  // Expose for getOnlinePlayers (defined at bottom, still inside IIFE now)
  let _gameOverBound = false; // FIX 5: guard so game:over listener is added once

  let _socketRetries = 0;
  const _socketMaxRetries = 30;
  function initSocket() {
    if (typeof io === 'undefined') {
        _socketRetries++;
        if (_socketRetries >= _socketMaxRetries) {
          console.error('[online] socket.io failed to load after 30s — server may be down.');
          document.querySelectorAll('.lobby-status').forEach(el => {
            el.textContent = 'Server unreachable. Please try again later.';
          });
          return;
        }
        console.warn('[online] socket.io not loaded — retrying in 1s');
        setTimeout(initSocket, 1000);
        return;
    }
    socket = io(SERVER_URL, { autoConnect: false });

    socket.on('game:error', ({ message }) => {
      if (message === 'Room expired') {
        localStorage.removeItem('onlineRoom');
      }
    });

    // FIX 3: This is the ONE connect listener. The duplicate inside the load
    // handler has been removed. player:online + game:rejoin are both emitted
    // here so they fire on every (re)connect automatically.
    socket.on('connect', () => {
      const username = window.getUsername?.() || '';
      if (username) socket.emit('player:online', { username });

      // Rejoin active room on reconnect (handles page refresh mid-game)
      const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
      if (room.roomId && username) {
        socket.emit('game:rejoin', { roomId: room.roomId, username });
      }
      if (typeof updateOnlineCount === 'function') updateOnlineCount();
    });
    socket.on('player:confirmed', () => {
      if (typeof updateOnlineCount === 'function') updateOnlineCount();
      });
    socket.on('match:incoming', ({ from }) => { showMatchRequest(from); });
    socket.on('match:declined', ({ by })  => { alert(`${by} declined your match request.`); });
    socket.on('match:error',    ({ message }) => { alert(message); });
    socket.on('queue:waiting',  () => {
      localStorage.removeItem('onlineRoom');
      console.log('⏳ Waiting...');
    });

    socket.on('game:move', ({ move, fen }) => {
      console.log('📨 received move', move);
      if (_onlineMoveCallback) _onlineMoveCallback(move, fen);
    });

    socket.on('game:state', ({ moves }) => {
      if (!moves || !moves.length) return;
      console.log(`🔄 Replaying ${moves.length} moves after rejoin`);
      _onlineReceiving = true;
      for (const move of moves) {
          if (move && move.from && move.to) {
              window.applyMove(move.from[0], move.from[1], move.to[0], move.to[1]);
          }
      }
      _onlineReceiving = false;
    });
    socket.on('game:start', ({ roomId, white, black }) => {
      const me = window.getUsername?.()
        || localStorage.getItem('chessUsername')
        || localStorage.getItem('redchess_username')
        || '';
      console.log(':start', { me, white, black });
      const myColor      = me === white ? 'w' : 'b';
      const opponentName = me === white ? black : white;
      localStorage.removeItem('onlineRoom');
      localStorage.setItem('onlineRoom', JSON.stringify({
        roomId, white, black, myColor, opponentName
      }));
      window.location.href = '../game.html';
    });

    socket.connect();
  }

  async function checkUsernameAvailable(name) {
    try {
      const res  = await fetch(`${SERVER_URL}/api/username/check?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      return data;
    } catch (e) { return { available: true }; }
  }

  async function registerUsername(name) {
    try {
      const res = await fetch(`${SERVER_URL}/api/username/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name })
      });
      return await res.json();
    } catch (e) { return { ok: true }; }
  }

  function patchUsernamePopup() {
    const confirmBtn = document.getElementById('usernameConfirm');
    const input      = document.getElementById('usernameInput');
    if (!confirmBtn || !input) return;

    confirmBtn.addEventListener('click', async (e) => {
      e.stopImmediatePropagation();
      const name = input.value.trim();
      if (!name) return;
      confirmBtn.disabled    = true;
      confirmBtn.textContent = 'Checking...';
      const { available, error } = await checkUsernameAvailable(name);
      if (!available) {
        confirmBtn.disabled    = false;
        confirmBtn.textContent = "Let's Play ♟";
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
      confirmBtn.disabled    = false;
      confirmBtn.textContent = "Let's Play ♟";
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: false }));
      if (socket) socket.emit('player:online', { username: name });
    }, true);
  }

  const observer = new MutationObserver(() => {
    if (document.getElementById('usernameConfirm')) {
      patchUsernamePopup();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.searchPlayer = async function (query) {
    if (!query || query.length < 2) return [];
    try {
      const res  = await fetch(`${SERVER_URL}/api/players/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.players || [];
    } catch (e) { return []; }
  };

  window.sendMatchRequest = (to) => socket?.emit('match:request', { to });

  window.Matchmaking = () => {
    // Guard: if socket.io never loaded (e.g. server down / network error),
    // socket is undefined — calling .once() on it throws immediately.
    if (!socket) {
      console.error('[online] Matchmaking called but socket is not ready — is the server reachable?');
      const statusEl = document.getElementById('statusMatchmaking');
      if (statusEl) statusEl.textContent = 'Cannot connect to server. Please try again later.';
      return;
    }
    localStorage.removeItem('onlineRoom');
    if (socket?.data?.username) {
      socket.emit('queue:join');
    } else {
      socket.once('player:confirmed', () => {
        socket.emit('queue:join');
      });
    }
  };

  window.leaveMatchmaking = () => socket?.emit('queue:leave');

  window.resignOnline = () => {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    socket?.emit('game:resign', { roomId: room.roomId });
  };

  window.onOnlineMove = function (callback) {
    _onlineMoveCallback = callback;
  };

  window.sendOnlineMove = function (move, fen) {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    socket?.emit('game:move', { roomId: room.roomId, move, fen });
  };

  // FIX 4: `from` is sanitized via textContent before being injected into the
  // popup. Previously a malicious server-sent `from` value could run arbitrary
  // JS via innerHTML injection.
  function showMatchRequest(from) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:2rem;right:2rem;
      background:#181818;border:1px solid rgba(201,168,76,.35);
      border-radius:14px;padding:18px 20px;
      font-family:'Cinzel',serif;color:#fff;
      z-index:10001;box-shadow:0 12px 40px rgba(0,0,0,.8);
      max-width:260px;
    `;
    // FIX 4: build DOM nodes instead of injecting `from` raw into innerHTML
    const label = document.createElement('div');
    label.style.cssText = 'font-size:13px;color:rgba(201,168,76,.8);margin-bottom:6px;';
    label.textContent = 'Match Request';

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:14px;';
    msg.textContent = `⚔️ ${from} wants to play!`; // textContent = safe

    const btnRow    = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';

    const acceptBtn  = document.createElement('button');
    acceptBtn.style.cssText  = 'flex:1;background:#c0392b;border:none;border-radius:8px;color:#fff;padding:9px;cursor:pointer;font-weight:700;font-size:13px;';
    acceptBtn.textContent    = 'Accept';

    const declineBtn = document.createElement('button');
    declineBtn.style.cssText = 'flex:1;background:#252525;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;padding:9px;cursor:pointer;font-size:13px;';
    declineBtn.textContent   = 'Decline';

    btnRow.appendChild(acceptBtn);
    btnRow.appendChild(declineBtn);
    el.appendChild(label);
    el.appendChild(msg);
    el.appendChild(btnRow);
    document.body.appendChild(el);

    acceptBtn.onclick  = () => { socket?.emit('match:accept',  { from }); el.remove(); };
    declineBtn.onclick = () => { socket?.emit('match:decline', { from }); el.remove(); };
    setTimeout(() => el.remove(), 30000);
  }

  window._redChessOnline = { socket: () => socket };
  initSocket();

  // Set board orientation before game.js reads it
  (function setOnlineRole() {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    if (!room.myColor) return;
    const botCfg = JSON.parse(localStorage.getItem('botSettings') || 'null');
    if (botCfg && botCfg.active) return;

    // FIX 2: removed `window._botActive = true` — that's a bot flag and must
    // NOT be set for online games. It was causing game.js to treat real online
    // matches as bot games.
    window._playerCol = room.myColor;
    window._flipped   = room.myColor === 'b';
  })();

  window.addEventListener('load', function () {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    if (!room.myColor || !room.roomId) return;

    // FIX 3: game:rejoin + player:online are now handled inside the single
    // connect listener in initSocket(). Removed the duplicate socket.on here
    // so we don't stack extra listeners on every page load / reconnect.

    if (typeof window.updatePlayerBars === 'function') window.updatePlayerBars();
    const nameEl   = document.getElementById('opponentName');
    const avatarEl = document.getElementById('opponentAvatar');
    if (nameEl)   nameEl.textContent   = room.opponentName || 'Opponent';
    if (avatarEl) avatarEl.textContent = '♟';

    const myName = window.getUsername?.() || localStorage.getItem('chessUsername') || 'You';

    window._getPlayerName = function (color) {
      return color === room.myColor ? myName : (room.opponentName || 'Opponent');
    };

    const indicator = document.getElementById('turnIndicator');
    if (indicator && !window.gameOver) {
      const whoseTurn = window.turn === room.myColor ? myName : (room.opponentName || 'Opponent');
      indicator.textContent = `${whoseTurn}'s Turn`;
      indicator.className   = 'turn-indicator ' + (window.turn === 'w' ? 'white-turn' : 'black-turn');
    }

    const bottomColor = window._flipped ? 'b' : 'w';
    const topColor    = window._flipped ? 'w' : 'b';
    const bottomBar   = document.getElementById('playerBarBottom');
    const topBar      = document.getElementById('playerBarTop');
    const dotClass    = (c) => `p-dot ${c === 'w' ? 'p-dot-white' : 'p-dot-black'}`;
    if (bottomBar) bottomBar.innerHTML = `<span class="${dotClass(bottomColor)}"></span>${bottomColor === room.myColor ? myName : room.opponentName}`;
    if (topBar)    topBar.innerHTML    = `<span class="${dotClass(topColor)}"></span>${topColor === room.myColor ? myName : room.opponentName}`;

    // FIX 5: guard ensures game:over listener is only ever added once, even if
    // the socket reconnects or load fires again. Previously a fresh listener
    // was stacked every load, causing endGame() to fire multiple times.
    if (!_gameOverBound) {
  _gameOverBound = true;

  socket.on('game:over', ({ reason, loser }) => {
    if (reason === 'draw') {
      window.endGame('Draw — Both players agreed!');
    } else {
      const winnerName = window._getPlayerName(
        loser === window.getUsername?.()
          ? (room.myColor === 'w' ? 'b' : 'w')
          : room.myColor
      );
      window.endGame(`${loser} resigned — ${winnerName} wins!`);
    }
  });

  // ← NEW: opponent closed tab / lost connection
  socket.on('game:opponent_left', () => {
    const myName = window.getUsername?.() || 'You';
    window.endGame(`Opponent disconnected — ${myName} wins!`);
    localStorage.removeItem('onlineRoom');
  });
}
    // Flip board labels for black
    const flipped = room.myColor === 'b';
    const ranks = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
    const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    const rl = document.getElementById('rankLabels');
    const fl = document.getElementById('fileLabels');
    if (rl) { rl.innerHTML = ''; ranks.forEach(r => { const s = document.createElement('span'); s.textContent = r; rl.appendChild(s); }); }
    if (fl) { fl.innerHTML = ''; files.forEach(f => { const s = document.createElement('span'); s.textContent = f; fl.appendChild(s); }); }

    if (typeof window.applyMove !== 'function') {
      console.error('[online] applyMove not found — script load order issue');
      return;
    }

    const _originalApplyMove = window.applyMove;
    let _onlineReceiving = false;

    window.applyMove = function (fromRow, fromCol, toRow, toCol) {
    // block local moves if it's not our turn
    if (!_onlineReceiving && window.turn !== room.myColor) return;
    _originalApplyMove(fromRow, fromCol, toRow, toCol);
    // only send to server if this was a local move, not incoming
    if (!_onlineReceiving) {
        window.sendOnlineMove({ from: [fromRow, fromCol], to: [toRow, toCol] }, null);
    }
};

window.onOnlineMove((move) => {
    console.log('📨 applying opponent move', move);
    if (!move || !move.from || !move.to) return;
    // bypass turn guard for incoming opponent moves
    _onlineReceiving = true;
    // call original directly so the turn guard in our patched version is skipped
    _originalApplyMove(move.from[0], move.from[1], move.to[0], move.to[1]);
    _onlineReceiving = false;
});

    if (typeof window.renderBoard === 'function') window.renderBoard();
    window.addEventListener('beforeunload', () => {
  if (!window.gameOver) {
    const r = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    if (r.roomId) socket?.emit('game:resign', { roomId: r.roomId });
  }
  });
  });

  // FIX 1: getOnlinePlayers is now INSIDE the IIFE so it can access SERVER_URL.
  // Previously it was outside and threw ReferenceError: SERVER_URL is not defined.
  window.getOnlinePlayers = async function () {
    try {
      const res  = await fetch(`${SERVER_URL}/api/players/online`);
      const data = await res.json();
      return data.players || [];
    } catch (e) { return []; }
  };

})();
