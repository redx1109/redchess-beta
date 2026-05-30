require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);

const allowedOrigins = [
  'https://beta.redchess.workers.dev',
  'https://red.redchess.workers.dev',
  'https://redchess.workers.dev',
  'http://localhost:3000',
  'http://localhost:5500'
];

app.use(cors({ origin: allowedOrigins, methods: ['GET','POST'], credentials: true }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET','POST'], credentials: true }
});

// ─── MongoDB ─────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, { family: 4, serverSelectionTimeoutMS: 5000 });

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

// ─── Matchmaking queue (in-memory only) ──────────────────────────────────────
const matchmakingQueue = [];

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/username/check', async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name || name.length < 2) return res.json({ available: false, error: 'Too short' });
  if (name.length > 20)         return res.json({ available: false, error: 'Too long' });
  if (!/^[a-zA-Z0-9_]+$/.test(name))
    return res.json({ available: false, error: 'Only letters, numbers and underscores' });
  const exists = await Player.findOne({ username: { $regex: new RegExp(`^${name}$`, 'i') } });
  res.json({ available: !exists });
});

app.post('/api/username/register', async (req, res) => {
  const name = (req.body.username || '').trim();
  if (!name || name.length < 2) return res.status(400).json({ ok: false, error: 'Too short' });
  if (name.length > 20)         return res.status(400).json({ ok: false, error: 'Too long' });
  if (!/^[a-zA-Z0-9_]+$/.test(name))
    return res.status(400).json({ ok: false, error: 'Only letters, numbers and underscores' });
  try {
    const player = await Player.findOneAndUpdate(
      { username: { $regex: new RegExp(`^${name}$`, 'i') } },
      { username: name },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, username: player.username });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ ok: false, error: 'Username taken' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.get('/api/players/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ players: [] });
  const players = await Player.find({ username: { $regex: new RegExp(q, 'i') } })
    .limit(10).select('username online -_id');
  res.json({ players });
});

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  socket.on('player:online', async ({ username }) => {
    if (!username) return;
    socket.data.username = username;
    await Player.findOneAndUpdate({ username }, { socketId: socket.id, online: true });
    socket.join(username);
    console.log(`👤 Online: ${username}`);
  });

  socket.on('game:rejoin', async ({ roomId, username }) => {
    const room = await Room.findOne({ roomId });
    if (!room) {
      console.log(`❌ rejoin failed, room gone: ${roomId}`);
      socket.emit('game:error', { message: 'Room expired' });
      return;
    }
    socket.join(roomId);
    console.log(`🔄 Rejoined: ${username} → ${roomId}`);
  });

  socket.on('match:request', async ({ to }) => {
    const from = socket.data.username;
    if (!from || !to || from === to) return;
    const target = await Player.findOne({ username: to });
    if (!target || !target.online)
      return socket.emit('match:error', { message: `${to} is offline or doesn't exist` });
    io.to(to).emit('match:incoming', { from });
    console.log(`⚔️  Match request: ${from} → ${to}`);
  });

  socket.on('match:accept', async ({ from }) => {
    const to = socket.data.username;
    if (!from || !to) return;
    const roomId = [from, to].sort().join('_') + '_' + Date.now();
    const white  = Math.random() < 0.5 ? from : to;
    const black  = white === from ? to : from;

    await Room.create({ roomId, white, black }); // ✅ saved to MongoDB

    const whitePlayer = await Player.findOne({ username: from });
    if (whitePlayer?.socketId) {
      const ws = io.sockets.sockets.get(whitePlayer.socketId);
      if (ws) ws.join(roomId);
    }
    socket.join(roomId);
    io.to(roomId).emit('game:start', { roomId, white, black });
    console.log(`🎮 Game started: ${roomId}`);
  });

  socket.on('match:decline', async ({ from }) => {
    const to = socket.data.username;
    io.to(from).emit('match:declined', { by: to });
  });

  socket.on('queue:join', async () => {
    const username = socket.data.username;
    if (!username) return;
    const idx = matchmakingQueue.findIndex(p => p.username === username);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);

    if (matchmakingQueue.length > 0) {
      const opponent = matchmakingQueue.shift();
      const roomId   = [username, opponent.username].sort().join('_') + '_' + Date.now();
      const white    = Math.random() < 0.5 ? username : opponent.username;
      const black    = white === username ? opponent.username : username;

      await Room.create({ roomId, white, black }); // ✅ saved to MongoDB

      socket.join(roomId);
      const oppSocket = io.sockets.sockets.get(opponent.socketId);
      if (oppSocket) oppSocket.join(roomId);
      io.to(roomId).emit('game:start', { roomId, white, black });
      console.log(`🎲 Random match: ${white} vs ${black} [${roomId}]`);
    } else {
      matchmakingQueue.push({ username, socketId: socket.id });
      socket.emit('queue:waiting');
      console.log(`⏳ Queued: ${username}`);
    }
  });

  socket.on('queue:leave', () => {
    const idx = matchmakingQueue.findIndex(p => p.username === socket.data.username);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
    socket.emit('queue:left');
  });

  socket.on('game:move', async ({ roomId, move, fen }) => {
    const room = await Room.findOne({ roomId });
    if (!room) {
      console.log(`❌ room not found: ${roomId}`);
      return;
    }
    await Room.updateOne({ roomId }, { $push: { moves: move } });
    socket.to(roomId).emit('game:move', { move, fen });
    console.log(`✅ move synced: ${roomId}`);
  });

  socket.on('game:resign', async ({ roomId }) => {
    const username = socket.data.username;
    socket.to(roomId).emit('game:over', { reason: 'resign', loser: username });
    await Room.deleteOne({ roomId });
  });

  socket.on('game:drawOffer',   ({ roomId }) => socket.to(roomId).emit('game:drawOffer'));
  socket.on('game:drawAccept',  async ({ roomId }) => {
    io.to(roomId).emit('game:over', { reason: 'draw' });
    await Room.deleteOne({ roomId });
  });
  socket.on('game:drawDecline', ({ roomId }) => socket.to(roomId).emit('game:drawDeclined'));

  socket.on('disconnect', async () => {
    const username = socket.data.username;
    if (username) {
      await Player.findOneAndUpdate({ username }, { socketId: null, online: false });
      const idx = matchmakingQueue.findIndex(p => p.username === username);
      if (idx !== -1) matchmakingQueue.splice(idx, 1);
      console.log(`👋 Offline: ${username}`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 RedChess server running on port ${PORT}`));
