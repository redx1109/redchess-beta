// ─── online.js ───────────────────────────────────────────────────────────────
let socket;
(function () {
  'use strict';
  let _onlineMoveCallback = null;
  const SERVER_URL = 'https://redchess-beta.up.railway.app';

  function initSocket() {
    if (typeof io === 'undefined') {
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
    socket.on('connect', () => {
        const username = window.getUsername?.();
        if (username) socket.emit('player:online', { username });
    });

    socket.on('match:incoming', ({ from }) => { showMatchRequest(from); });
    socket.on('match:declined', ({ by })  => { alert(`${by} declined your match request.`); });
    socket.on('match:error',    ({ message }) => { alert(message); });
    socket.on('queue:waiting',  () => { localStorage.removeItem('onlineRoom'); console.log('⏳ Waiting...'); });

    // ✅ OUTSIDE game:start — runs on game.html too!
    socket.on('game:move', ({ move, fen }) => {
        console.log('📨 received move', move);
        if (_onlineMoveCallback) _onlineMoveCallback(move, fen);
    });

    socket.on('game:start', ({ roomId, white, black }) => {
        const me = window.getUsername?.() 
        || localStorage.getItem('chessUsername')
        || localStorage.getItem('redchess_username') // ← add fallbacks
        || '';
        console.log(':start', { me, white, black });
        const myColor      = me === white ? 'w' : 'b';
        const opponentName = me === white ? black : white;
        localStorage.removeItem('onlineRoom');
        localStorage.setItem('onlineRoom', JSON.stringify({
            roomId, white, black, myColor, opponentName
        }));
        window.location.href = '../game.html';
        // ✅ REMOVED :move from here!
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

  window.sendMatchRequest  = (to)       => socket?.emit('match:request', { to });
  window.Matchmaking = () => {
    localStorage.removeItem('onlineRoom');
    if (socket?.data?.username) {
        socket.emit('queue:join');
    } else {
        socket.once('player:confirmed', () => {
            socket.emit('queue:join');
        });
    }
  };
  window.leaveMatchmaking  = ()         => socket?.emit('queue:leave');
  window.resignOnline  = ()         => {
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
    setTimeout(() => el.remove(), 30000);
  }

  window._redChessOnline = { socket: () => socket };
  initSocket();

  // ── FIX 1: set window._flipped BEFORE game.js reads it ───────────────────
  (function setOnlineRole() {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    if (!room.myColor) return;
    // ── Don't override if a bot game is active ──
    const botCfg = JSON.parse(localStorage.getItem('botSettings') || 'null');
    if (botCfg && botCfg.active) return; 
    
    window._botActive = true;
    window._playerCol = room.myColor;
    window._flipped   = room.myColor === 'b';  // game.js must read window._flipped
  })();

  // ── FIX 2 & 3: wait for full load before patching applyMove & nameplates ──
  window.addEventListener('load', function () {
    const room = JSON.parse(localStorage.getItem('onlineRoom') || '{}');
    if (!room.myColor || !room.roomId) return;

    // Rejoin the room with new socket connection ✅
    socket.on('connect', () => {
        const username = window.getUsername?.() || '';
        if (username) {
            socket.emit('player:online', { username });
            socket.emit('game:rejoin', { roomId: room.roomId, username });
        }
    });
    if (socket.connected) {
        const username = window.getUsername?.() || '';
        socket.emit('player:online', { username });
        socket.emit('game:rejoin', { roomId: room.roomId, username });
    }
    // FIX 2 — set opponent name AFTER updatePlayerBars so it isn't overwritten
    if (typeof window.updatePlayerBars === 'function') window.updatePlayerBars();
    const nameEl   = document.getElementById('opponentName');
    const avatarEl = document.getElementById('opponentAvatar');
    if (nameEl)   nameEl.textContent   = room.opponentName || 'Opponent';
    if (avatarEl) avatarEl.textContent = '♟';
// ✅ ADD EVERYTHING BELOW HERE ↓
const myName = window.getUsername?.() || localStorage.getItem('chessUsername') || 'You';

window._getPlayerName = function(color) {
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
    // Flip board labels for black
    const flipped = room.myColor === 'b';
    const ranks = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
    const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    const rl = document.getElementById('rankLabels');
    const fl = document.getElementById('fileLabels');
    if (rl) { rl.innerHTML = ''; ranks.forEach(r => { const s = document.createElement('span'); s.textContent = r; rl.appendChild(s); }); }
    if (fl) { fl.innerHTML = ''; files.forEach(f => { const s = document.createElement('span'); s.textContent = f; fl.appendChild(s); }); }

    // FIX 3 — patch applyMove only after game.js has defined it
    if (typeof window.applyMove !== 'function') {
      console.error('[online] applyMove not found — script load order issue');
      return;
    }

    const _originalApplyMove = window.applyMove;
    let _onlineReceiving = false;

    window.applyMove = function (fromRow, fromCol, toRow, toCol) {
    if (!_onlineReceiving && window.turn !== room.myColor) return;
    _originalApplyMove(fromRow, fromCol, toRow, toCol);
    if (!_onlineReceiving) {
        window.sendOnlineMove({ from: [fromRow, fromCol], to: [toRow, toCol] }, null);
    }
};

    window.onOnlineMove((move) => {
      console.log('📨 received move', move); 
      _onlineReceiving = true;
      window.applyMove(move.from[0], move.from[1], move.to[0], move.to[1]);
      _onlineReceiving = false;
    });

    if (typeof window.renderBoard === 'function') window.renderBoard();
  });

})();
window.getOnlinePlayers = async function() {
    try {
        const res = await fetch(`${SERVER_URL}/api/players/online`);
        const data = await res.json();
        return data.players || [];
    } catch(e) { return []; }
};
