// ─── playonline.js — Online multiplayer via PeerJS (WebRTC) ────────────────────

(function () {
'use strict';
 
// ── Config ───────────────────────────────────────────────────────────────────
const CODE_CHARS      = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN        = 6;
const SESSION_KEY     = 'chessOnlineSession';
const SESSION_TTL     = 10 * 60 * 1000;   // 10 min reconnect window
const RECONNECT_GRACE = 35 * 1000;       // opponent waits 35s before giving up
const PING_INTERVAL   = 5000;            // heartbeat every 5s
const PING_TIMEOUT    = 15000;           // no pong for 15s → disconnected

const ICE_SERVERS = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "fc7fe9227df23155139feb35",
        credential: "sE/7NuJ35/XzsQ5v",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "fc7fe9227df23155139feb35",
        credential: "sE/7NuJ35/XzsQ5v",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "fc7fe9227df23155139feb35",
        credential: "sE/7NuJ35/XzsQ5v",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "fc7fe9227df23155139feb35",
        credential: "sE/7NuJ35/XzsQ5v",
      },
  ];
});
const PEER_CONFIG = {
    host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 0,
    config: { iceServers: ICE_SERVERS },
};

// ── State ────────────────────────────────────────────────────────────────────
let peer              = null;
let conn              = null;
let myColor           = null;   // 'w' | 'b'
let myRole            = null;   // 'host' | 'guest'
let myCode            = null;
let isReceiving       = false;
let isReconnectFlow   = false;
let isUnloading       = false;
let reconnectTimer    = null;   // grace period timer on opponent's side
let reconnectFailTimer = null;  // our own "give up" timer after refresh
let guestRetryTimer   = null;   // guest retry interval handle

// ── Heartbeat state ───────────────────────────────────────────────────────────
let pingIntervalId    = null;
let pingTimeoutId     = null;

// ── Draw state ────────────────────────────────────────────────────────────────
let _drawOffered  = false;   // we offered a draw
let _drawReceived = false;   // opponent offered a draw (pending our answer)

// ── DOM refs ─────────────────────────────────────────────────────────────────
const overlay     = document.getElementById('lobbyOverlay');
const discOverlay = document.getElementById('disconnectOverlay');
const discTitle    = discOverlay.querySelector('.lobby-title');
const discStatuses = discOverlay.querySelectorAll('.lobby-status');
const discTop      = discStatuses[0];
const discSubtitle = discStatuses[1];

// ── True originals from game.js (captured once before any wrapping) ──────────
const _trueApplyMove  = window.applyMove;
const _trueResignGame = window.resignGame;
const _trueEndGame    = window.endGame;

// ── Utility ───────────────────────────────────────────────────────────────────
function randomCode() {
    let s = '';
    for (let i = 0; i < CODE_LEN; i++)
        s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showView(id) {
    overlay.querySelectorAll('.lobby-view').forEach(v => {
        v.style.display = (v.id === id) ? 'flex' : 'none';
    });
}
function showLobby() {
    overlay.style.opacity    = '1';
    overlay.style.transition = '';
    overlay.style.display    = 'flex';
}
function hideLobby() {
    overlay.style.transition = 'opacity 0.45s ease';
    overlay.style.opacity    = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 450);
}
function setStatus(viewSuffix, msg, type) {
    const el = document.getElementById('status' + viewSuffix);
    if (!el) return;
    el.textContent = msg;
    el.className   = 'lobby-status' + (type ? ' ' + type : '');
}
function setTurnIndicator(text, cls) {
    const el = document.getElementById('turnIndicator');
    if (!el) return;
    el.textContent = text;
    el.className   = 'turn-indicator' + (cls ? ' ' + cls : '');
}

// ── Connection quality dot ────────────────────────────────────────────────────
function setConnQuality(state) {
    // state: 'good' | 'warn' | 'bad' | 'off'
    const dot = document.getElementById('connQualityDot');
    if (!dot) return;
    dot.className = 'conn-dot conn-dot--' + state;
    const labels = { good: 'Connected', warn: 'Reconnecting', bad: 'Disconnected', off: '' };
    dot.title = labels[state] || '';
    // Inline colours so the reconnecting state is unmistakably golden
    const colors = { good: '#4caf50', warn: '#ffd700', bad: '#e05555', off: 'transparent' };
    const glows  = { good: '', warn: '0 0 7px 2px rgba(255,215,0,0.7)', bad: '', off: '' };
    dot.style.background = colors[state] || '';
    dot.style.boxShadow  = glows[state]  || '';
}

// ── Session persistence ───────────────────────────────────────────────────────
function saveSession() {
    if (!myRole || !myCode || !myColor) return;
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            role: myRole, code: myCode, color: myColor, ts: Date.now(),
            connected: true,   // only saved from onConnected so always true
        }));
    } catch (e) {}
}
function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
}
function loadSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s.connected || Date.now() - s.ts > SESSION_TTL) { clearSession(); return null; }
        return s;
    } catch (e) { return null; }
}

// ── localStorage game state helpers ──────────────────────────────────────────
function nukeSavedGame() {
    try { localStorage.removeItem('chessGameState'); } catch (e) {}
    if (typeof clearSavedState === 'function') clearSavedState();
}

// ── Board state capture / apply ───────────────────────────────────────────────
function captureGameState() {
    try {
        return {
            board:     JSON.parse(JSON.stringify(window.boardState)),
            turn:      window.turn,
            castling:  JSON.parse(JSON.stringify(window.castling)),
            enPassant: window.enPassant,
        };
    } catch (e) { return null; }
}
function applyGameState(state) {
    if (!state || !state.board) return;
    try {
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                window.boardState[r][c] = state.board[r][c];
        if (state.turn      != null) window.turn      = state.turn;
        if (state.castling)          window.castling  = state.castling;
        if (state.enPassant != null) window.enPassant = state.enPassant;
        window.renderBoard();
        // Restore the turn indicator — checkReconnect() left it as "Reconnecting…"
        if (state.turn != null) {
            const turnText = state.turn === 'w' ? "White's Turn" : "Black's Turn";
            const turnCls  = state.turn === 'w' ? 'white-turn'  : 'black-turn';
            setTurnIndicator(turnText, turnCls);
        }
    } catch (e) { console.error('[Online] applyGameState error:', e); }
}

// ── URL-based code sharing ────────────────────────────────────────────────────
function getCodeFromURL() {
    // Support ?join=CODE and #CODE
    const params = new URLSearchParams(window.location.search);
    if (params.has('join')) return params.get('join').toUpperCase().slice(0, CODE_LEN);
    const hash = window.location.hash.replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{4,6}$/.test(hash)) return hash;
    return null;
}

function buildJoinURL(code) {
    return `${window.location.origin}${window.location.pathname}?join=${code}`;
}

// ── Menu buttons ──────────────────────────────────────────────────────────────
document.getElementById('btnCreate').addEventListener('click', () => {
    nukeSavedGame();
    showView('viewCreate');
    startHosting();
});

document.getElementById('btnShowJoin').addEventListener('click', () => {
    cleanupPeer();
    showView('viewJoin');
    // Pre-fill code from URL if present
    const urlCode = getCodeFromURL();
    if (urlCode) {
        fillCodeBoxes(urlCode);
        setStatus('Join', 'Code pre-filled from link — click Connect to join.');
    } else {
        clearCodeBoxes();
        setStatus('Join', 'Enter the 6-character code your opponent shared.');
    }
    document.querySelector('.code-box-input')?.focus();
});

document.getElementById('btnCreateBack').addEventListener('click', () => {
    cleanupPeer();
    clearSession();
    nukeSavedGame();
    showView('viewMenu');
});

document.getElementById('btnJoinBack').addEventListener('click', () => {
    cleanupPeer();
    clearSession();
    nukeSavedGame();
    showView('viewMenu');
    // Clean URL
    history.replaceState(null, '', window.location.pathname);
});

// ── Split code-box input ──────────────────────────────────────────────────────
function getCodeBoxes() {
    return Array.from(document.querySelectorAll('.code-box-input'));
}

function getCodeValue() {
    return getCodeBoxes().map(b => b.value).join('');
}

function fillCodeBoxes(code) {
    const boxes = getCodeBoxes();
    code.split('').forEach((ch, i) => { if (boxes[i]) boxes[i].value = ch; });
}

function clearCodeBoxes() {
    getCodeBoxes().forEach(b => { b.value = ''; });
}

function initCodeBoxes() {
    const boxes = getCodeBoxes();
    boxes.forEach((box, i) => {
        box.addEventListener('input', () => {
            const val = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            box.value = val ? val[val.length - 1] : '';
            if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        });

        box.addEventListener('keydown', e => {
            if (e.key === 'Backspace' && !box.value && i > 0) {
                boxes[i - 1].value = '';
                boxes[i - 1].focus();
            }
            if (e.key === 'Enter') document.getElementById('btnJoinConfirm').click();
            if (e.key === 'ArrowLeft'  && i > 0) boxes[i - 1].focus();
            if (e.key === 'ArrowRight' && i < boxes.length - 1) boxes[i + 1].focus();
        });

        box.addEventListener('paste', e => {
            e.preventDefault();
            const pasted = (e.clipboardData || window.clipboardData)
                .getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
            fillCodeBoxes(pasted);
            const last = Math.min(pasted.length, boxes.length - 1);
            boxes[last].focus();
        });

        box.addEventListener('focus', () => box.select());
    });
}

document.getElementById('btnJoinConfirm').addEventListener('click', () => {
    const code = getCodeValue().trim().toUpperCase();
    if (code.length < 4) { setStatus('Join', 'Enter the code your opponent shared.', 'error'); return; }
    nukeSavedGame();
    startJoining(code);
});

document.getElementById('btnCopyCode').addEventListener('click', () => {
    const code = document.getElementById('gameCode').textContent;
    const btn  = document.getElementById('btnCopyCode');
    navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'COPIED ✓';
        setTimeout(() => { btn.textContent = 'COPY CODE'; }, 2000);
    }).catch(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('gameCode'));
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    });
});

document.getElementById('btnShareLink').addEventListener('click', () => {
    const code = document.getElementById('gameCode').textContent;
    const url  = buildJoinURL(code);
    const btn  = document.getElementById('btnShareLink');
    navigator.clipboard.writeText(url).then(() => {
        btn.textContent = 'LINK COPIED ✓';
        setTimeout(() => { btn.textContent = 'SHARE LINK'; }, 2500);
    }).catch(() => { window.prompt('Copy this link:', url); });
});

// ── Disconnect overlay buttons ────────────────────────────────────────────────
document.getElementById('btnDisconnectBack').addEventListener('click', () => {
    cleanupPeer();
    clearSession();
    nukeSavedGame();
    discOverlay.classList.remove('show');
    location.href = '../../index.html';
});
document.getElementById('btnDisconnectRematch').addEventListener('click', () => {
    discOverlay.classList.remove('show');
    _resetDiscOverlay();
    cleanupPeer();
    clearSession();
    nukeSavedGame();
    restoreGameFunctions();
    window.location.reload();
});

// ── Draw offer button ─────────────────────────────────────────────────────────
const drawBtn = document.getElementById('drawBtn');
if (drawBtn) {
    drawBtn.addEventListener('click', () => {
        if (window.gameOver || !conn || !conn.open) return;
        if (_drawOffered) return; // already offered
        _drawOffered = true;
        drawBtn.textContent  = 'Draw offered…';
        drawBtn.disabled     = true;
        conn.send({ type: 'draw-offer' });
    });
}

// ── Draw banner (incoming offer) ──────────────────────────────────────────────
function showDrawBanner() {
    const banner = document.getElementById('drawBanner');
    if (!banner) return;
    banner.style.display = 'flex';
}
function hideDrawBanner() {
    const banner = document.getElementById('drawBanner');
    if (!banner) return;
    banner.style.display = 'none';
}

const btnDrawAccept  = document.getElementById('btnDrawAccept');
const btnDrawDecline = document.getElementById('btnDrawDecline');
if (btnDrawAccept) {
    btnDrawAccept.addEventListener('click', () => {
        hideDrawBanner();
        _drawReceived = false;
        if (conn && conn.open) conn.send({ type: 'draw-accept' });
        _endAsDraw();
    });
}
if (btnDrawDecline) {
    btnDrawDecline.addEventListener('click', () => {
        hideDrawBanner();
        _drawReceived = false;
        if (conn && conn.open) conn.send({ type: 'draw-decline' });
    });
}

function _endAsDraw() {
    clearSession();
    nukeSavedGame();
    if (window.endGame) window.endGame('Draw by agreement');
    _resetDraw();
}
function _resetDraw() {
    _drawOffered = _drawReceived = false;
    hideDrawBanner();
    const db = document.getElementById('drawBtn');
    if (db) { db.textContent = 'Offer Draw'; db.disabled = false; }
}

// ── Hosting ───────────────────────────────────────────────────────────────────
function startHosting(existingCode) {
    cleanupPeer();
    myColor = 'w';
    myRole  = 'host';
    myCode  = existingCode || randomCode();

    document.getElementById('gameCode').textContent = myCode;
    if (!isReconnectFlow) setStatus('Create', 'Waiting for opponent to join…');

    peer = new Peer(myCode, PEER_CONFIG);

    peer.on('open', id => {
        console.log('[Online] Hosting, code:', id);
        if (isReconnectFlow) setStatus('Create', 'Reconnecting — waiting for opponent…');
    });

    peer.on('connection', incoming => {
        if (conn && conn.open) { incoming.close(); return; }
        if (conn) { try { conn.close(); } catch(e) {} conn = null; }
        conn = incoming;
        if (!isReconnectFlow) setStatus('Create', 'Opponent found! Starting game…', 'success');
        setupConnection('host');
    });

    peer.on('error', err => {
        console.error('[Online] Host peer error:', err);
        if (err.type === 'unavailable-id') {
            peer.destroy(); peer = null;
            setTimeout(() => startHosting(existingCode), 1500);
            return;
        }
        if (!isReconnectFlow) setStatus('Create', 'Connection error. Try again.', 'error');
    });
}

// ── Joining ───────────────────────────────────────────────────────────────────
function startJoining(code) {
    cleanupPeer();
    clearGuestRetry();
    myColor = 'b';
    myRole  = 'guest';
    myCode  = code;

    if (!isReconnectFlow) setStatus('Join', 'Connecting…');

    peer = new Peer(undefined, PEER_CONFIG);

    peer.on('open', () => {
        conn = peer.connect(myCode, { reliable: true });
        setupConnection('guest');
    });

    peer.on('error', err => {
        console.error('[Online] Guest peer error:', err);
        if (err.type === 'peer-unavailable') {
            if (isReconnectFlow) {
                peer.destroy(); peer = null;
                guestRetryTimer = setTimeout(() => startJoining(code), 2500);
                return;
            }
            setStatus('Join', 'Room not found. Check the code and try again.', 'error');
        } else {
            if (!isReconnectFlow)
                setStatus('Join', 'Could not connect. Check the code and try again.', 'error');
        }
    });
}

function clearGuestRetry() {
    if (guestRetryTimer) { clearTimeout(guestRetryTimer); guestRetryTimer = null; }
}

// ── Connection lifecycle ──────────────────────────────────────────────────────
function setupConnection(role) {
    const timeout = setTimeout(() => {
        if (!conn || !conn.open) {
            if (role === 'host') setStatus('Create', 'No one joined yet. Still waiting…');
            else                 setStatus('Join',   'Connection timed out. Check the code.', 'error');
        }
    }, 20000);

    conn.on('open', () => {
        clearTimeout(timeout);
        clearGuestRetry();
        console.log('[Online] DataChannel open  role:', role, 'color:', myColor, 'reconnect:', isReconnectFlow);
        setConnQuality('good');

        const pc = conn.peerConnection;
        if (pc) {
            pc.addEventListener('iceconnectionstatechange', () => {
                if (pc.iceConnectionState === 'failed') {
                    setConnQuality('bad');
                    pc.restartIce();
                }
                if (pc.iceConnectionState === 'disconnected') {
                    setConnQuality('warn');
                    setTimeout(() => {
                        if (pc.iceConnectionState !== 'connected' &&
                            pc.iceConnectionState !== 'completed') onDisconnect();
                    }, 8000);
                }
                if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                    setConnQuality('good');
                }
            });
        }

        startHeartbeat();
        onConnected();
    });

    conn.on('data', handleData);

    conn.on('close', () => {
        if (isUnloading) return;
        if (window.gameOver) return;
        stopHeartbeat();
        onOpponentReconnecting();
    });

    conn.on('error', () => {
        if (!isUnloading && !window.gameOver) {
            stopHeartbeat();
            onDisconnect();
        }
    });
}

// ── Heartbeat (ping / pong) ───────────────────────────────────────────────────
function startHeartbeat() {
    stopHeartbeat();
    pingIntervalId = setInterval(() => {
        if (!conn || !conn.open) return;
        try { conn.send({ type: 'ping', ts: Date.now() }); } catch (e) {}
        // If no pong within PING_TIMEOUT, treat as silent disconnect
        pingTimeoutId = setTimeout(() => {
            if (!isUnloading && !window.gameOver) {
                console.warn('[Online] Ping timeout — silent disconnect detected');
                setConnQuality('bad');
                stopHeartbeat();
                onOpponentReconnecting();
            }
        }, PING_TIMEOUT);
    }, PING_INTERVAL);
}

function stopHeartbeat() {
    if (pingIntervalId) { clearInterval(pingIntervalId);  pingIntervalId = null; }
    if (pingTimeoutId)  { clearTimeout(pingTimeoutId);    pingTimeoutId  = null; }
}

// ── Data handler ──────────────────────────────────────────────────────────────
function handleData(data) {
    if (!data || !data.type) return;
    switch (data.type) {
        case 'ping':
            if (conn && conn.open) try { conn.send({ type: 'pong' }); } catch(e) {}
            break;
        case 'pong':
            // Got a pong — cancel the pending timeout
            if (pingTimeoutId) { clearTimeout(pingTimeoutId); pingTimeoutId = null; }
            setConnQuality('good');
            break;
        case 'move':          onReceiveMove(data.from, data.to); break;
        case 'resign':        onReceiveResign(); break;
        case 'reconnecting':  onOpponentReconnecting(); break;
        case 'rematch-request': _onOpponentRematch(); break;
        case 'state-request':
            if (conn && conn.open) conn.send({ type: 'state', state: captureGameState() });
            break;
        case 'state': applyGameState(data.state); break;
        case 'draw-offer':    onReceiveDrawOffer(); break;
        case 'draw-accept':   onReceiveDrawAccept(); break;
        case 'draw-decline':  onReceiveDrawDecline(); break;
    }
}

// ── Draw message handlers ─────────────────────────────────────────────────────
function onReceiveDrawOffer() {
    _drawReceived = true;
    showDrawBanner();
}
function onReceiveDrawAccept() {
    _resetDraw();
    _endAsDraw();
}
function onReceiveDrawDecline() {
    _drawOffered = false;
    const db = document.getElementById('drawBtn');
    if (db) {
        db.textContent = 'Offer Draw';
        db.disabled    = false;
        // Brief visual feedback
        db.style.color = '#e05555';
        setTimeout(() => { db.style.color = ''; }, 1800);
    }
}

// ── Game start ────────────────────────────────────────────────────────────────
function onConnected() {
    if (reconnectFailTimer) { clearTimeout(reconnectFailTimer); reconnectFailTimer = null; }
    // Always cancel the grace timer and dismiss the overlay — covers both the
    // refreshing player AND the waiting opponent whose timer was left running.
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    _resetDiscOverlay();
    discOverlay.classList.remove('show');
    _stopWaitingReconnect();

    window._botActive = true;
    window._playerCol = myColor;
    window._flipped   = (myColor === 'b');

    window.applyMove = function (fromRow, fromCol, toRow, toCol) {
        _trueApplyMove(fromRow, fromCol, toRow, toCol);
        if (!isReceiving && conn && conn.open)
            conn.send({ type: 'move', from: [fromRow, fromCol], to: [toRow, toCol] });
        // A move cancels any pending draw offer
        _resetDraw();
    };
    window.resignGame = function () {
        if (window.gameOver) return;
        if (conn && conn.open) conn.send({ type: 'resign' });
        clearSession();
        nukeSavedGame();
        const winner = window.turn === 'w' ? 'Black' : 'White';
        const loser  = window.turn === 'w' ? 'White' : 'Black';
        window.endGame(`${loser} resigned — ${winner} wins`);
    };
    window.endGame = function (msg) {
        if (_trueEndGame) _trueEndGame(msg);
        clearTimeout(reconnectTimer);
        stopHeartbeat();
        setConnQuality('off');
        clearSession();   // prevent stale session from auto-reconnecting on next visit
        nukeSavedGame();
        _resetDraw();
        _showRematchBtn();
    };
    window.askEngine = function () {};

    window.renderBoard();
    updateBoardLabels();
    updatePlayerTags();

    // Show draw button
    const db = document.getElementById('drawBtn');
    if (db) db.style.display = '';

    if (isReconnectFlow) {
        isReconnectFlow = false;
        // Whichever side refreshed has lost its in-memory state — always request it
        if (conn && conn.open)
            conn.send({ type: 'state-request' });
    }

    saveSession();
    hideLobby();
}

// ── Receive move ──────────────────────────────────────────────────────────────
function onReceiveMove(from, to) {
    if (!from || !to) return;
    const [fromRow, fromCol] = from;
    const [toRow, toCol]     = to;
    if (window._animating) { setTimeout(() => onReceiveMove(from, to), 80); return; }
    window._animating = true;
    animateGameMove(fromRow, fromCol, toRow, toCol, () => {
        window._animating = false;
        isReceiving = true;
        window.applyMove(fromRow, fromCol, toRow, toCol);
        isReceiving = false;
    });
}

// ── Opponent resigned ─────────────────────────────────────────────────────────
function onReceiveResign() {
    clearSession();
    nukeSavedGame();
    const winner = myColor === 'w' ? 'White' : 'Black';
    if (window.endGame) window.endGame(`Opponent resigned — ${winner} wins`);
}

// ── Opponent reconnecting ─────────────────────────────────────────────────────
function onOpponentReconnecting() {
    clearTimeout(reconnectTimer);
    setConnQuality('warn');

    if (discTitle)    discTitle.textContent    = 'Opponent Reconnecting';
    if (discTop)      discTop.textContent      = '';
    if (discSubtitle) discSubtitle.textContent = 'Waiting for your opponent to return…';

    discOverlay.querySelectorAll('.lobby-btn').forEach(b => {
        b.dataset.origDisplay = b.style.display;
        b.style.display = 'none';
    });
    discOverlay.classList.add('show');

    _startWaitingReconnect();

    reconnectTimer = setTimeout(() => {
        _resetDiscOverlay();
        _stopWaitingReconnect();
        onDisconnect();
    }, RECONNECT_GRACE);
}

let _waitReconnectTimer = null;
let _waitReconnectDelay = 1500;

function _startWaitingReconnect() {
    _stopWaitingReconnect();
    _waitReconnectDelay = 1500;  // reset backoff
    if (!myCode || !myRole) return;
    if (myRole === 'guest') {
        _waitReconnectTimer = setTimeout(function retry() {
            if (!isUnloading && myRole === 'guest' && myCode) {
                if (!conn || !conn.open) {
                    cleanupPeer();
                    peer = new Peer(undefined, PEER_CONFIG);
                    peer.on('open', () => {
                        conn = peer.connect(myCode, { reliable: true });
                        setupConnection('guest');
                    });
                    peer.on('error', () => {
                        try { peer.destroy(); } catch(e) {}
                        peer = null;
                        // Exponential backoff capped at 10s
                        _waitReconnectDelay = Math.min(_waitReconnectDelay * 1.5, 10000);
                        _waitReconnectTimer = setTimeout(retry, _waitReconnectDelay);
                    });
                }
            }
        }, _waitReconnectDelay);
    } else {
        if (!peer || peer.destroyed) {
            startHosting(myCode);
        }
    }
}
function _stopWaitingReconnect() {
    if (_waitReconnectTimer) { clearTimeout(_waitReconnectTimer); _waitReconnectTimer = null; }
}

// ── Real disconnect ───────────────────────────────────────────────────────────
function onDisconnect() {
    if (isUnloading) return;
    console.warn('[Online] Disconnected');
    _stopWaitingReconnect();
    stopHeartbeat();
    setConnQuality('bad');
    clearSession();
    nukeSavedGame();
    _resetDiscOverlay();
    discOverlay.classList.add('show');
}

function _resetDiscOverlay() {
    clearTimeout(reconnectTimer);
    if (discTitle)    discTitle.textContent    = 'Connection Lost';
    if (discTop)      discTop.textContent      = '';
    if (discSubtitle) discSubtitle.textContent = 'Your opponent disconnected.';
    discOverlay.querySelectorAll('.lobby-btn').forEach(b => {
        b.style.display = b.dataset.origDisplay !== undefined ? b.dataset.origDisplay : '';
    });
}

// ── Restore original game.js functions ───────────────────────────────────────
function restoreGameFunctions() {
    window.applyMove  = _trueApplyMove;
    window.resignGame = _trueResignGame;
    window.endGame    = _trueEndGame;
    window._botActive = false;
    window._playerCol = null;
    window._flipped   = false;
}

// ── Cleanup PeerJS ────────────────────────────────────────────────────────────
function cleanupPeer() {
    clearGuestRetry();
    stopHeartbeat();
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) {
    try { peer.disconnect(); } catch(e) {}
}
}

// ── Board label / player tag updates ─────────────────────────────────────────
function updateBoardLabels() {
    const flipped = !!window._flipped;
    const ranks = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
    const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    const rl = document.getElementById('rankLabels');
    const fl = document.getElementById('fileLabels');
    if (rl) { rl.innerHTML = ''; ranks.forEach(r => { const s = document.createElement('span'); s.textContent = r; rl.appendChild(s); }); }
    if (fl) { fl.innerHTML = ''; files.forEach(f => { const s = document.createElement('span'); s.textContent = f; fl.appendChild(s); }); }
}
function updatePlayerTags() {
    const topTag = document.getElementById('playerTagTop');
    const botTag = document.getElementById('playerTagBottom');
    if (!topTag || !botTag) return;
    botTag.innerHTML = `${myColor === 'w' ? 'White' : 'Black'} <span class="you-label">· you</span>`;
    topTag.innerHTML  = myColor === 'w' ? 'Black' : 'White';
}

// ── Rematch ───────────────────────────────────────────────────────────────────
let _rematchOffered  = false;
let _rematchAccepted = false;

function _showRematchBtn() {
    const btn = document.getElementById('rematchBtn');
    if (!btn) return;
    btn.style.display = '';
    btn.textContent   = 'Rematch';
    btn.onclick       = _offerRematch;
}
function _offerRematch() {
    if (!conn || !conn.open) return;
    _rematchOffered = true;
    const btn = document.getElementById('rematchBtn');
    if (btn) { btn.textContent = 'Waiting for opponent…'; btn.onclick = null; }
    conn.send({ type: 'rematch-request' });
    if (_rematchAccepted) _startRematch();
}
function _onOpponentRematch() {
    _rematchAccepted = true;
    if (_rematchOffered) {
        _startRematch();
    } else {
        const btn = document.getElementById('rematchBtn');
        if (btn) { btn.style.display = ''; btn.textContent = 'Accept Rematch'; btn.onclick = _offerRematch; }
    }
}
function _startRematch() {
    myColor = myColor === 'w' ? 'b' : 'w';
    _rematchOffered = _rematchAccepted = false;
    _resetDraw();

    const start = [
        ['bR','bN','bB','bQ','bK','bB','bN','bR'],
        ['bP','bP','bP','bP','bP','bP','bP','bP'],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        ['wP','wP','wP','wP','wP','wP','wP','wP'],
        ['wR','wN','wB','wQ','wK','wB','wN','wR'],
    ];
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            window.boardState[r][c] = start[r][c];

    window.turn      = 'w';
    window.castling  = { w: { K:true, Q:true }, b: { K:true, Q:true } };
    window.enPassant = null;
    window.gameOver  = false;
    nukeSavedGame();

    window._botActive = true;
    window._playerCol = myColor;
    window._flipped   = (myColor === 'b');

    saveSession();
    updateBoardLabels();
    updatePlayerTags();
    window.renderBoard();
    startHeartbeat();
    setConnQuality('good');

    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) rematchBtn.style.display = 'none';
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.style.display = 'none';
    const moveLogEl = document.getElementById('moveLog');
    if (moveLogEl) moveLogEl.innerHTML = '';
    ['gameOverOverlay','endOverlay'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    setTurnIndicator("White's Turn", 'white-turn');
    const resignBtn = document.getElementById('resignBtn');
    if (resignBtn) resignBtn.style.display = '';
    const drawBtn2 = document.getElementById('drawBtn');
    if (drawBtn2) { drawBtn2.style.display = ''; drawBtn2.textContent = 'Offer Draw'; drawBtn2.disabled = false; }
}

// ── Auto-reconnect on page load ───────────────────────────────────────────────
function checkReconnect() {
    // If the user manually hit F5 / reload, don't reconnect — show the lobby fresh.
    // Only reconnect on true navigation (tab restored, link clicked, etc.)
    const session = loadSession();
    if (!session) return false;

    console.log('[Online] Session found, reconnecting as', session.role);
    isReconnectFlow = true;
    myColor = session.color;
    myRole  = session.role;
    myCode  = session.code;

    window._botActive = true;
    window._playerCol = myColor;
    window._flipped   = (myColor === 'b');
    updateBoardLabels();
    updatePlayerTags();

    overlay.style.display = 'none';
    setTurnIndicator('Reconnecting…');
    setConnQuality('warn');

    reconnectFailTimer = setTimeout(() => {
        if (!isReconnectFlow) return;
        isReconnectFlow = false;
        clearGuestRetry();
        cleanupPeer();
        clearSession();
        setConnQuality('bad');
        _resetDiscOverlay();
        if (discTitle)    discTitle.textContent    = 'Reconnect Failed';
        if (discSubtitle) discSubtitle.textContent = 'Could not reconnect to the game.';
        discOverlay.classList.add('show');
    }, SESSION_TTL);

    if (session.role === 'host') {
        startHosting(session.code);
    } else {
        startJoining(session.code);
    }
    return true;
}

// ── Page unload ───────────────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
    isUnloading = true;

    if (!window.gameOver) {
        saveSession();
    }

    try {
        if (conn) conn.close();
    } catch(e) {}

    try {
        if (peer) peer.destroy();
    } catch(e) {}
});

// ── Init ──────────────────────────────────────────────────────────────────────
initCodeBoxes();

// Auto-open join view if URL has a code
const _urlCode = getCodeFromURL();
if (_urlCode && !checkReconnect()) {
    showView('viewJoin');
    fillCodeBoxes(_urlCode);
    setStatus('Join', 'Code pre-filled from link — click Connect to join.');
} else {
    checkReconnect();
}

})();
