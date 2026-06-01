require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);

const allowedOrigins = [
  'https://beta.redchess.workers.dev'
];

app.use(cors({ origin: allowedOrigins, methods: ['GET','POST'], credentials: true }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET','POST'], credentials: true }
});

// ─── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, { family: 4, serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection failed:', err.message));

// FIX 2: Clear stale online=true players left over from previous server instance
// (Railway free tier restarts frequently; disconnect handlers don't always fire on crash)
mongoose.connection.once('open', async () => {
  try {
    const cleared = await Player.updateMany({ online: true }, { online: false, socketId: null });
    console.log(`✅ Cleared ${cleared.modifiedCount} stale online player(s)`);
  } catch (err) {
    console.error('[startup cleanup]', err.message);
  }
});

const playerSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true, maxlength: 20 },
  socketId:  { type: String, default: null },
  online:    { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Player = mongoose.model('Player', playerSchema);

const roomSchema = new mongoose.Schema({
  roomId:    { type: String, required: true, unique: true },
  white:     String,
  black:     String,
  moves:     { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now, expires: 3600 }
});
const Room = mongoose.model('Room', roomSchema);

// ─── Matchmaking queue (in-memory) ───────────────────────────────────────────
// NOTE: This resets on server restart. Free-tier Railway restarts frequently.
// Players waiting in queue when the server restarts will be silently dropped.
const matchmakingQueue = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Look up a live socket by username via the active socket registry
// instead of the stale socketId stored in MongoDB.
function getLiveSocket(username) {
  for (const [, sock] of io.sockets.sockets) {
    if (sock.data.username === username) return sock;
  }
  return null;
}

async function startGame(roomId, white, black) {
  await Room.create({ roomId, white, black });

  const whiteSocket = getLiveSocket(white);
  const blackSocket = getLiveSocket(black);
  if (whiteSocket) whiteSocket.join(roomId);
  if (blackSocket) blackSocket.join(roomId);

  io.to(roomId).emit('game:start', { roomId, white, black });
  console.log(`🎮 Game started: ${white} (w) vs ${black} (b) [${roomId}]`);
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.get('/api/username/check', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name || name.length < 2) return res.json({ available: false, error: 'Too short' });
    if (name.length > 20)         return res.json({ available: false, error: 'Too long' });
    if (!/^[a-zA-Z0-9_]+$/.test(name))
      return res.json({ available: false, error: 'Only letters, numbers and underscores' });
    const exists = await Player.findOne({ username: { $regex: new RegExp(`^${name}$`, 'i') } });
    res.json({ available: !exists });
  } catch (err) {
    console.error('[/api/username/check]', err.message);
    res.status(500).json({ available: false, error: 'Server error' });
  }
});

app.post('/api/username/register', async (req, res) => {
  try {
    const name = (req.body.username || '').trim();
    if (!name || name.length < 2) return res.status(400).json({ ok: false, error: 'Too short' });
    if (name.length > 20)         return res.status(400).json({ ok: false, error: 'Too long' });
    if (!/^[a-zA-Z0-9_]+$/.test(name))
      return res.status(400).json({ ok: false, error: 'Only letters, numbers and underscores' });
    const player = await Player.findOneAndUpdate(
      { username: { $regex: new RegExp(`^${name}$`, 'i') } },
      { username: name },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, username: player.username });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ ok: false, error: 'Username taken' });
    console.error('[/api/username/register]', err.message);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// FIX 3: Use live socket registry for accurate online status instead of stale DB field
app.get('/api/players/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ players: [] });

    const players = await Player.find({ username: { $regex: new RegExp(q, 'i') } })
      .limit(10).select('username -_id');

    // Check live socket registry for real-time online status
    const result = players.map(p => ({
      username: p.username,
      online: !!getLiveSocket(p.username)
    }));

    res.json({ players: result });
  } catch (err) {
    console.error('[/api/players/search]', err.message);
    res.json({ players: [] });
  }
});

// FIX 1: Use live socket registry — 100% accurate, no DB staleness
// Previously queried DB for online:true which was unreliable after server restarts
app.get('/api/players/online', async (req, res) => {
  try {
    const onlinePlayers = [];
    for (const [, sock] of io.sockets.sockets) {
      if (sock.data.username) {
        onlinePlayers.push({ username: sock.data.username });
      }
    }
    res.json({ players: onlinePlayers });
  } catch (err) {
    console.error('[/api/players/online]', err.message);
    res.json({ players: [] });
  }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  socket.on('player:online', async ({ username }) => {
    try {
      if (!username) return;
      socket.data.username = username;
      await Player.findOneAndUpdate({ username }, { socketId: socket.id, online: true });
      socket.join(username);
      console.log(`👤 Online: ${username}`);
      socket.emit('player:confirmed');
    } catch (err) {
      console.error('[player:online]', err.message);
    }
  });

  socket.on('game:rejoin', async ({ roomId, username }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        console.log(`❌ rejoin failed, room gone: ${roomId}`);
        socket.emit('game:error', { message: 'Room expired' });
        return;
      }
      socket.join(roomId);
      socket.emit('game:state', {
            moves: room.moves,
            white: room.white,
            black: room.black
        });
      console.log(`🔄 Rejoined: ${username} → ${roomId}`);
    } catch (err) {
      console.error('[game:rejoin]', err.message);
    }
  });

  socket.on('match:request', async ({ to }) => {
    try {
      const from = socket.data.username;
      if (!from || !to || from === to) return;
      // FIX 3: check live socket instead of stale DB online field
      const targetSocket = getLiveSocket(to);
      if (!targetSocket)
        return socket.emit('match:error', { message: `${to} is offline or doesn't exist` });
      io.to(to).emit('match:incoming', { from });
      console.log(`⚔️  Match request: ${from} → ${to}`);
    } catch (err) {
      console.error('[match:request]', err.message);
    }
  });

  socket.on('match:accept', async ({ from }) => {
    try {
      const to     = socket.data.username;
      if (!from || !to) return;
      const roomId = [from, to].sort().join('_') + '_' + Date.now();
      const white  = Math.random() < 0.5 ? from : to;
      const black  = white === from ? to : from;
      await startGame(roomId, white, black);
    } catch (err) {
      console.error('[match:accept]', err.message);
    }
  });

  socket.on('match:decline', ({ from }) => {
    const to = socket.data.username;
    io.to(from).emit('match:declined', { by: to });
  });

  socket.on('queue:join', async () => {
    try {
      const username = socket.data.username;
      if (!username) return;

      // Remove if already queued (dedup)
      const idx = matchmakingQueue.findIndex(p => p.username === username);
      if (idx !== -1) matchmakingQueue.splice(idx, 1);

      if (matchmakingQueue.length > 0) {
        const opponent = matchmakingQueue.shift();
        const roomId   = [username, opponent.username].sort().join('_') + '_' + Date.now();
        const white    = Math.random() < 0.5 ? username : opponent.username;
        const black    = white === username ? opponent.username : username;
        await startGame(roomId, white, black);
      } else {
        matchmakingQueue.push({ username, socketId: socket.id });
        socket.emit('queue:waiting');
        console.log(`⏳ Queued: ${username}`);
      }
    } catch (err) {
      console.error('[queue:join]', err.message);
    }
  });

  socket.on('queue:leave', () => {
    const idx = matchmakingQueue.findIndex(p => p.username === socket.data.username);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
    socket.emit('queue:left');
  });

  socket.on('game:move', async ({ roomId, move, fen }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        console.log(`❌ room not found: ${roomId}`);
        return;
      }
      await Room.updateOne({ roomId }, { $push: { moves: move } });
      socket.to(roomId).emit('game:move', { move, fen });
      console.log(`✅ move synced: ${roomId}`);
    } catch (err) {
      console.error('[game:move]', err.message);
    }
  });

  socket.on('game:resign', async ({ roomId }) => {
    try {
      const username = socket.data.username;
      socket.to(roomId).emit('game:over', { reason: 'resign', loser: username });
      await Room.deleteOne({ roomId });
    } catch (err) {
      console.error('[game:resign]', err.message);
    }
  });

  socket.on('game:drawOffer',   ({ roomId }) => socket.to(roomId).emit('game:drawOffer'));

  socket.on('game:drawAccept',  async ({ roomId }) => {
    try {
      io.to(roomId).emit('game:over', { reason: 'draw' });
      await Room.deleteOne({ roomId });
    } catch (err) {
      console.error('[game:drawAccept]', err.message);
    }
  });

  socket.on('game:drawDecline', ({ roomId }) => socket.to(roomId).emit('game:drawDeclined'));

  socket.on('disconnect', async () => {
    try {
      const username = socket.data.username;
      if (username) {
        await Player.findOneAndUpdate({ username }, { socketId: null, online: false });
        const idx = matchmakingQueue.findIndex(p => p.username === username);
        if (idx !== -1) matchmakingQueue.splice(idx, 1);
        console.log(`👋 Offline: ${username}`);

        // ← NEW: tell opponent their game ended if a room exists
        const activeRoom = await Room.findOne({
  $or: [{ white: username }, { black: username }]
});
if (activeRoom) {
  console.log(`⏳ Grace period started for room ${activeRoom.roomId} — ${username} disconnected`);
  setTimeout(async () => {
    try {
      const whiteOnline = !!getLiveSocket(activeRoom.white);
      const blackOnline = !!getLiveSocket(activeRoom.black);
      if (whiteOnline && blackOnline) {
        // both back — do nothing
        console.log(`✅ Both players rejoined ${activeRoom.roomId}`);
      } else if (!whiteOnline && !blackOnline) {
        await Room.deleteOne({ roomId: activeRoom.roomId });
        console.log(`🏳️ Room ${activeRoom.roomId} closed — both players gone`);
      } else {
        const gone = !whiteOnline ? activeRoom.white : activeRoom.black;
        io.to(activeRoom.roomId).emit('game:opponent_left');
        await Room.deleteOne({ roomId: activeRoom.roomId });
        console.log(`🏳️ Room ${activeRoom.roomId} closed — ${gone} disconnected`);
      }
    } catch (err) {
      console.error('[disconnect grace]', err.message);
    }
  }, 8000);
}
      }
    } catch (err) {
      console.error('[disconnect]', err.message);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 RedChess server running on port ${PORT}`));
