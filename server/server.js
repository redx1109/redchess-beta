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
  'https://redchesss.vercel.app'
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
  // Store TC so rejoining players get it back
  tc:        { type: Object, default: null },
  createdAt: { type: Date, default: Date.now, expires: 3600 }
});
const Room = mongoose.model('Room', roomSchema);

// ─── TC presets (single source of truth on the server) ───────────────────────
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

// ─── Matchmaking queues bucketed by TC key ────────────────────────────────────
// matchmakingQueues['blitz3'] = [{ username, socketId }, ...]
// matchmakingQueues['none']   = [...]   ← for no time control
const matchmakingQueues = {};

function getQueue(tcKey) {
  const key = tcKey || 'none';
  if (!matchmakingQueues[key]) matchmakingQueues[key] = [];
  return matchmakingQueues[key];
}

function removeFromAllQueues(username) {
  for (const key of Object.keys(matchmakingQueues)) {
    const idx = matchmakingQueues[key].findIndex(p => p.username === username);
    if (idx !== -1) matchmakingQueues[key].splice(idx, 1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getLiveSocket(username) {
  for (const [, sock] of io.sockets.sockets) {
    if (sock.data.username === username) return sock;
  }
  return null;
}

async function startGame(roomId, white, black, tc) {
  await Room.create({ roomId, white, black, tc: tc || null });

  const whiteSocket = getLiveSocket(white);
  const blackSocket = getLiveSocket(black);
  if (whiteSocket) whiteSocket.join(roomId);
  if (blackSocket) blackSocket.join(roomId);

  // Send TC data to both players so their timecontrol.js can start
  io.to(roomId).emit('game:start', { roomId, white, black, tc: tc || null });
  console.log(`🎮 Game started: ${white} (w) vs ${black} (b) [${roomId}] TC: ${tc ? tc.key : 'none'}`);
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

app.get('/api/players/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ players: [] });
    const players = await Player.find({ username: { $regex: new RegExp(q, 'i') } })
      .limit(10).select('username -_id');
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

app.get('/api/players/online', async (req, res) => {
  try {
    const me = (req.query.username || '').trim();
    const uniqueNames = new Set();
    for (const [, sock] of io.sockets.sockets) {
      if (sock.data.username) uniqueNames.add(sock.data.username);
    }
    const total = uniqueNames.size;
    if (me) uniqueNames.delete(me);
    const players = [...uniqueNames].map(username => ({ username }));
    res.json({ players, total });
  } catch (err) {
    console.error('[/api/players/online]', err.message);
    res.json({ players: [], total: 0 });
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
      io.emit('player:count_changed'); 
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
      // Send TC back to rejoining player so their clock resumes correctly
      socket.emit('game:state', {
        moves: room.moves,
        white: room.white,
        black: room.black,
        tc:    room.tc || null
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
      // Friend matches start with no TC (can extend later)
      await startGame(roomId, white, black, null);
    } catch (err) {
      console.error('[match:accept]', err.message);
    }
  });

  socket.on('match:decline', ({ from }) => {
    const to = socket.data.username;
    io.to(from).emit('match:declined', { by: to });
  });

  // ─── Matchmaking: now accepts a tcKey ──────────────────────────────────────
  socket.on('queue:join', async ({ tc } = {}) => {
    try {
      const username = socket.data.username;
      if (!username) return;

      // Remove from any existing queue slot first (handles re-queue)
      removeFromAllQueues(username);

      // Validate TC key — fall back to 'none' if unknown
      const tcKey    = (tc && TC_PRESETS[tc.key]) ? tc.key : 'none';
      const tcData   = tcKey !== 'none' ? { key: tcKey, ...TC_PRESETS[tcKey] } : null;
      const queue    = getQueue(tcKey);

      if (queue.length > 0) {
        const opponent = queue.shift();
        const roomId   = [username, opponent.username].sort().join('_') + '_' + Date.now();
        const white    = Math.random() < 0.5 ? username : opponent.username;
        const black    = white === username ? opponent.username : username;
        await startGame(roomId, white, black, tcData);
      } else {
        queue.push({ username, socketId: socket.id, tcKey });
        socket.emit('queue:waiting');
        console.log(`⏳ Queued: ${username} [TC: ${tcKey}]`);
      }
    } catch (err) {
      console.error('[queue:join]', err.message);
    }
  });

  socket.on('queue:leave', () => {
    removeFromAllQueues(socket.data.username);
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

  // ─── Clock relay: one player moved, relay times to their opponent ──────────
  // This keeps both clocks in sync without the server needing to run its own timer.
  socket.on('game:clock_move', ({ roomId, times }) => {
    if (!roomId || !times) return;
    socket.to(roomId).emit('game:clock_switch', { times });
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

  socket.on('game:drawAccept', async ({ roomId }) => {
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
        removeFromAllQueues(username);
        console.log(`👋 Offline: ${username}`);
        io.emit('player:count_changed');
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
