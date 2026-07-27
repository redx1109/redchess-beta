// ─── RedChess Worker (replaces server.js) ─────────────────────────────────
// REST endpoints use D1 (players table). Real-time (matchmaking, moves,
// clocks, presence) lives in the "Hub" Durable Object — a single global
// instance that mirrors the in-memory logic your Node server used to hold.

const TC_PRESETS = {
  bullet1:  { minutes: 1,  increment: 0 },
  bullet2:  { minutes: 2,  increment: 1 },
  blitz3:   { minutes: 3,  increment: 0 },
  blitz3i2: { minutes: 3,  increment: 2 },
  blitz5:   { minutes: 5,  increment: 0 },
  rapid10:  { minutes: 10, increment: 0 },
  rapid15:  { minutes: 15, increment: 10 },
  rapid30:  { minutes: 30, increment: 0 },
};

const ALLOWED_ORIGINS = [
  'https://beta.redchess.workers.dev',
  'https://redchesss.vercel.app'
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

const NAME_RE = /^[a-zA-Z0-9_]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    // ─── WebSocket entry point → forward to the singleton Hub DO ─────────
    if (url.pathname === '/ws') {
      const id  = env.HUB.idFromName('global');
      const stub = env.HUB.get(id);
      return stub.fetch(request);
    }

    // ─── REST API (D1-backed) ──────────────────────────────────────────
    if (url.pathname === '/api/health') {
      return json({ status: 'ok' }, 200, origin);
    }

    if (url.pathname === '/api/username/check') {
      const name = (url.searchParams.get('name') || '').trim();
      if (!name || name.length < 2) return json({ available: false, error: 'Too short' }, 200, origin);
      if (name.length > 20)         return json({ available: false, error: 'Too long' }, 200, origin);
      if (!NAME_RE.test(name))      return json({ available: false, error: 'Only letters, numbers and underscores' }, 200, origin);
      const row = await env.DB.prepare('SELECT 1 FROM players WHERE username = ? COLLATE NOCASE').bind(name).first();
      return json({ available: !row }, 200, origin);
    }

    if (url.pathname === '/api/username/register' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const name = (body.username || '').trim();
      if (!name || name.length < 2) return json({ ok: false, error: 'Too short' }, 400, origin);
      if (name.length > 20)         return json({ ok: false, error: 'Too long' }, 400, origin);
      if (!NAME_RE.test(name))      return json({ ok: false, error: 'Only letters, numbers and underscores' }, 400, origin);
      const existing = await env.DB.prepare('SELECT username FROM players WHERE username = ? COLLATE NOCASE').bind(name).first();
      if (existing) return json({ ok: false, error: 'Username taken' }, 409, origin);
      await env.DB.prepare('INSERT INTO players (username, createdAt) VALUES (?, ?)').bind(name, Date.now()).run();
      return json({ ok: true, username: name }, 200, origin);
    }

    if (url.pathname === '/api/players/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return json({ players: [] }, 200, origin);
      const { results } = await env.DB.prepare('SELECT username FROM players WHERE username LIKE ? LIMIT 10')
        .bind(`%${q}%`).all();
      // Ask the Hub who's actually online right now
      const id = env.HUB.idFromName('global');
      const stub = env.HUB.get(id);
      const onlineResp = await stub.fetch('https://hub/internal/online-set');
      const onlineSet = new Set(await onlineResp.json());
      return json({ players: results.map(p => ({ username: p.username, online: onlineSet.has(p.username) })) }, 200, origin);
    }

    if (url.pathname === '/api/players/online') {
      const me = (url.searchParams.get('username') || '').trim();
      const id = env.HUB.idFromName('global');
      const stub = env.HUB.get(id);
      const resp = await stub.fetch('https://hub/internal/online-list?me=' + encodeURIComponent(me));
      return new Response(resp.body, { headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
    }

    return json({ error: 'Not found' }, 404, origin);
  }
};

// ─── Hub Durable Object ─────────────────────────────────────────────────
export class Hub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();           // WebSocket -> { username }
    this.byUsername = new Map();        // username -> WebSocket
    this.queues = {};                   // tcKey -> [{ username }]
    this.rooms = new Map();             // roomId -> { white, black, moves, tc, members:Set<username> }
  }

  getQueue(tcKey) {
    const key = tcKey || 'none';
    if (!this.queues[key]) this.queues[key] = [];
    return this.queues[key];
  }

  removeFromAllQueues(username) {
    for (const key of Object.keys(this.queues)) {
      this.queues[key] = this.queues[key].filter(p => p.username !== username);
    }
  }

  send(username, event, data) {
    const ws = this.byUsername.get(username);
    if (ws) ws.send(JSON.stringify({ event, data }));
  }

  sendToRoom(roomId, event, data, excludeUsername) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const uname of room.members) {
      if (uname === excludeUsername) continue;
      this.send(uname, event, data);
    }
  }

  broadcastAll(event, data) {
    for (const ws of this.sockets.keys()) ws.send(JSON.stringify({ event, data }));
  }

  async startGame(roomId, white, black, tc) {
    this.rooms.set(roomId, { white, black, moves: [], tc: tc || null, members: new Set([white, black]) });
    this.send(white, 'game:start', { roomId, white, black, tc: tc || null });
    this.send(black, 'game:start', { roomId, white, black, tc: tc || null });
  }

  scheduleGraceCheck(roomId, username) {
    setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (!room) return;
      const whiteOnline = this.byUsername.has(room.white);
      const blackOnline = this.byUsername.has(room.black);
      if (whiteOnline && blackOnline) return; // both back, keep room
      if (!whiteOnline && !blackOnline) { this.rooms.delete(roomId); return; }
      const gone = !whiteOnline ? room.white : room.black;
      this.sendToRoom(roomId, 'game:opponent_left', {}, gone);
      this.rooms.delete(roomId);
    }, 8000);
  }

  handleEvent(ws, event, data) {
    const meta = this.sockets.get(ws) || {};

    switch (event) {
      case 'player:online': {
        const username = data.username;
        if (!username) return;
        meta.username = username;
        this.sockets.set(ws, meta);
        this.byUsername.set(username, ws);
        this.send(username, 'player:confirmed', {});
        this.broadcastAll('player:count_changed', {});
        break;
      }
      case 'game:rejoin': {
        const room = this.rooms.get(data.roomId);
        if (!room) { this.send(meta.username, 'game:error', { message: 'Room expired' }); return; }
        room.members.add(meta.username);
        this.send(meta.username, 'game:state', { moves: room.moves, white: room.white, black: room.black, tc: room.tc || null });
        break;
      }
      case 'match:request': {
        const from = meta.username, to = data.to;
        if (!from || !to || from === to) return;
        if (!this.byUsername.has(to)) { this.send(from, 'match:error', { message: `${to} is offline or doesn't exist` }); return; }
        this.send(to, 'match:incoming', { from });
        break;
      }
      case 'match:accept': {
        const to = meta.username, from = data.from;
        if (!from || !to) return;
        const roomId = [from, to].sort().join('_') + '_' + Date.now();
        const white  = Math.random() < 0.5 ? from : to;
        const black  = white === from ? to : from;
        this.startGame(roomId, white, black, null);
        break;
      }
      case 'match:decline': {
        this.send(data.from, 'match:declined', { by: meta.username });
        break;
      }
      case 'queue:join': {
        const username = meta.username;
        if (!username) return;
        this.removeFromAllQueues(username);
        const tc = data.tc;
        const tcKey  = (tc && TC_PRESETS[tc.key]) ? tc.key : 'none';
        const tcData = tcKey !== 'none' ? { key: tcKey, ...TC_PRESETS[tcKey] } : null;
        const queue = this.getQueue(tcKey);
        if (queue.length > 0) {
          const opponent = queue.shift();
          const roomId = [username, opponent.username].sort().join('_') + '_' + Date.now();
          const white = Math.random() < 0.5 ? username : opponent.username;
          const black = white === username ? opponent.username : username;
          this.startGame(roomId, white, black, tcData);
        } else {
          queue.push({ username });
          this.send(username, 'queue:waiting', {});
        }
        break;
      }
      case 'queue:leave': {
        this.removeFromAllQueues(meta.username);
        this.send(meta.username, 'queue:left', {});
        break;
      }
      case 'game:move': {
        const room = this.rooms.get(data.roomId);
        if (!room) return;
        room.moves.push(data.move);
        this.sendToRoom(data.roomId, 'game:move', { move: data.move, fen: data.fen }, meta.username);
        break;
      }
      case 'game:clock_move': {
        this.sendToRoom(data.roomId, 'game:clock_switch', { times: data.times }, meta.username);
        break;
      }
      case 'game:resign': {
        this.sendToRoom(data.roomId, 'game:over', { reason: 'resign', loser: meta.username }, meta.username);
        this.rooms.delete(data.roomId);
        break;
      }
      case 'game:drawOffer': {
        this.sendToRoom(data.roomId, 'game:drawOffer', {}, meta.username);
        break;
      }
      case 'game:drawAccept': {
        this.sendToRoom(data.roomId, 'game:over', { reason: 'draw' });
        this.send(meta.username, 'game:over', { reason: 'draw' });
        this.rooms.delete(data.roomId);
        break;
      }
      case 'game:drawDecline': {
        this.sendToRoom(data.roomId, 'game:drawDeclined', {}, meta.username);
        break;
      }
    }
  }

  handleDisconnect(ws) {
    const meta = this.sockets.get(ws) || {};
    this.sockets.delete(ws);
    if (meta.username) {
      this.byUsername.delete(meta.username);
      this.removeFromAllQueues(meta.username);
      this.broadcastAll('player:count_changed', {});
      for (const [roomId, room] of this.rooms) {
        if (room.white === meta.username || room.black === meta.username) {
          this.scheduleGraceCheck(roomId, meta.username);
        }
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/internal/online-set') {
      return new Response(JSON.stringify([...this.byUsername.keys()]), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/internal/online-list') {
      const me = url.searchParams.get('me') || '';
      const names = [...this.byUsername.keys()].filter(n => n !== me);
      return new Response(JSON.stringify({ players: names.map(username => ({ username })), total: this.byUsername.size }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.set(server, {});

    server.addEventListener('message', (msg) => {
      try {
        const { event, data } = JSON.parse(msg.data);
        this.handleEvent(server, event, data || {});
      } catch (err) {
        console.error('[ws message]', err.message);
      }
    });
    server.addEventListener('close', () => this.handleDisconnect(server));
    server.addEventListener('error', () => this.handleDisconnect(server));

    return new Response(null, { status: 101, webSocket: client });
  }
}