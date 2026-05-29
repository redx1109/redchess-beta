// ─── RedChess Multiplayer Server ────────────────────────────────────────────
// Stack: Node.js + Express + Socket.io + MongoDB (Mongoose)
// Features:
//   • Unique username registration & lookup
//   • Send / accept / decline match requests
//   • Random matchmaking queue
//   • Game rooms (move sync, resign, draw)
// ────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const mongoose  = require('mongoose');
const cors      = require('cors');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

// ─── MongoDB connection ──────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, {
  family: 4,
  serverSelectionTimeoutMS: 5000,
})
// ─── Schema: Player ──────────────────────────────────────────────────────────
// Stores registered usernames + their current socket id
const playerSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true, maxlength: 20 },
  socketId:  { type: String, default: null },   // null = offline
  online:    { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Player = mongoose.model('Player', playerSchema);

// ─── In-memory state ─────────────────────────────────────────────────────────
const matchmakingQueue = [];          // array of { username, socketId }
const activeRooms      = new Map();   // roomId → { white, black, fen, moves[] }

// ─── REST API ─────────────────────────────────────────────────────────────────

// Check if a username is available
// GET /api/username/check?name=Red
app.get('/api/username/check', async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name || name.length < 2) return res.json({ available: false, error: 'Too short' });
  if (name.length > 20)         return res.json({ available: false, error: 'Too long' });
  if (!/^[a-zA-Z0-9_]+$/.test(name))
    return res.json({ available: false, error: 'Only letters, numbers and underscores' });

  const exists = await Player.findOne({ username: { $regex: new RegExp(`^${name}$`, 'i') } });
  res.json({ available: !exists });
});

// Register a username (called when player confirms their name)
// POST /api/username/register  { username }
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
    if (err.code === 11000)
      return res.status(409).json({ ok: false, error: 'Username taken' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Search players by username (for challenge requests)
// GET /api/players/search?q=Re
app.get('/api/players/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ players: [] });
  const players = await Player.find({
    username: { $regex: new RegExp(q, 'i') }
  }).limit(10).select('username online -_id');
  res.json({ players });
});

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // ── 1. Player goes online ───────────────────────────────────────────────────
  // Client emits this right after connecting, with their saved username
  socket.on('player:online', async ({ username }) => {
    if (!username) return;
    socket.data.username = username;
    await Player.findOneAndUpdate({ username }, { socketId: socket.id, online: true });
    socket.join(username); // each player has a personal room = their username
    console.log(`👤 Online: ${username}`);
  });

  // ── 2. Send a match request to a specific player ────────────────────────────
  socket.on('match:request', async ({ to }) => {
    const from = socket.data.username;
    if (!from || !to || from === to) return;

    const target = await Player.findOne({ username: to });
    if (!target || !target.online) {
      return socket.emit('match:error', { message: `${to} is offline or doesn't exist` });
    }
    // Send request to target's personal room
    io.to(to).emit('match:incoming', { from });
    console.log(`⚔️  Match request: ${from} → ${to}`);
  });

  // ── 3. Accept a match request ───────────────────────────────────────────────
  socket.on('match:accept', async ({ from }) => {
    const to = socket.data.username;
    if (!from || !to) return;

    const roomId = [from, to].sort().join('_') + '_' + Date.now();
    const room   = { white: from, black: to, fen: 'start', moves: [] };
    activeRooms.set(roomId, room);

    // Put both players in the room
    const whitePlayer = await Player.findOne({ username: from });
    if (whitePlayer?.socketId) {
      const ws = io.sockets.sockets.get(whitePlayer.socketId);
      if (ws) ws.join(roomId);
    }
    socket.join(roomId);

    io.to(roomId).emit('game:start', { roomId, white: from, black: to });
    console.log(`🎮 Game started: ${roomId}`);
  });

  // ── 4. Decline a match request ──────────────────────────────────────────────
  socket.on('match:decline', async ({ from }) => {
    const to = socket.data.username;
    io.to(from).emit('match:declined', { by: to });
  });

  // ── 5. Random matchmaking ───────────────────────────────────────────────────
  socket.on('queue:join', () => {
    const username = socket.data.username;
    if (!username) return;

    // Remove stale entries for this player
    const idx = matchmakingQueue.findIndex(p => p.username === username);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);

    if (matchmakingQueue.length > 0) {
      // Match with the first person waiting
      const opponent = matchmakingQueue.shift();
      const roomId   = [username, opponent.username].sort().join('_') + '_' + Date.now();
      const white    = Math.random() < 0.5 ? username : opponent.username;
      const black    = white === username ? opponent.username : username;

      activeRooms.set(roomId, { white, black, fen: 'start', moves: [] });

      socket.join(roomId);
      const oppSocket = io.sockets.sockets.get(opponent.socketId);
      if (oppSocket) oppSocket.join(roomId);

      io.to(roomId).emit('game:start', { roomId, white, black });
      console.log(`🎲 Random match: ${white} vs ${black} [${roomId}]`);
    } else {
      // No one waiting — add to queue
      matchmakingQueue.push({ username, socketId: socket.id });
      socket.emit('queue:waiting');
      console.log(`⏳ Queued: ${username}`);
    }
  });

  // Leave matchmaking queue
  socket.on('queue:leave', () => {
    const idx = matchmakingQueue.findIndex(p => p.username === socket.data.username);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
    socket.emit('queue:left');
  });

  // ── 6. Move sync ────────────────────────────────────────────────────────────
  socket.on('game:move', ({ roomId, move, fen }) => {
    const room = activeRooms.get(roomId);
    if (!room) return;
    room.fen = fen;
    room.moves.push(move);
    // Broadcast move to the OTHER player in the room
    socket.to(roomId).emit('game:move', { move, fen });
  });

  // ── 7. Resign ───────────────────────────────────────────────────────────────
  socket.on('game:resign', ({ roomId }) => {
    const username = socket.data.username;
    socket.to(roomId).emit('game:over', { reason: 'resign', winner: null, loser: username });
    activeRooms.delete(roomId);
  });

  // ── 8. Draw offer / response ────────────────────────────────────────────────
  socket.on('game:drawOffer',    ({ roomId }) => socket.to(roomId).emit('game:drawOffer'));
  socket.on('game:drawAccept',   ({ roomId }) => {
    io.to(roomId).emit('game:over', { reason: 'draw' });
    activeRooms.delete(roomId);
  });
  socket.on('game:drawDecline',  ({ roomId }) => socket.to(roomId).emit('game:drawDeclined'));

  // ── 9. Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    const username = socket.data.username;
    if (username) {
      await Player.findOneAndUpdate({ username }, { socketId: null, online: false });
      // Remove from matchmaking queue
      const idx = matchmakingQueue.findIndex(p => p.username === username);
      if (idx !== -1) matchmakingQueue.splice(idx, 1);
      console.log(`👋 Offline: ${username}`);
    }
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 RedChess server running on port ${PORT}`));
