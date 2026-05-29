# RedChess Multiplayer Server 🏰

## Setup in 4 steps

### 1. Install dependencies
```bash
cd redchess-server
npm install
```

### 2. Set up MongoDB Atlas (free)
1. Go to https://cloud.mongodb.com and create a free account
2. Create a free **M0** cluster
3. Go to **Connect → Drivers** and copy your connection string
4. It looks like: `mongodb+srv://youruser:yourpass@cluster0.xxxxx.mongodb.net/`

### 3. Configure environment
```bash
cp .env.example .env
```
Then open `.env` and fill in:
```
MONGO_URI=mongodb+srv://youruser:yourpass@cluster0.xxxxx.mongodb.net/redchess
PORT=3001
CLIENT_URL=https://yourdomain.com   ← your website URL
```

### 4. Run the server
```bash
# Production
npm start

# Development (auto-restarts on changes)
npm run dev
```

---

## Add to your frontend

### On every page (after username-popup.js):
```html
<script src="username-popup.js"></script>
<script src="online.js"></script>   ← add this
```

### Change the server URL in online.js:
```js
const SERVER_URL = 'https://your-server.com'; // line 9 in online.js
```

---

## What's included

| Feature | How |
|---|---|
| ✅ Unique usernames | Checked against MongoDB on register |
| ✅ Search player | `searchPlayer('Red')` → returns matches |
| ✅ Send match request | `sendMatchRequest('username')` |
| ✅ Random matchmaking | `joinMatchmaking()` / `leaveMatchmaking()` |
| ✅ Game rooms | Moves synced via Socket.io |
| ✅ Resign / Draw | `resignOnlineGame()` |
| ✅ Online status | Shows who's online in search results |

---

## Deploying the server

Cheapest options:
- **Railway** → https://railway.app (free tier available)
- **Render** → https://render.com (free tier available)
- **Fly.io** → https://fly.io (free tier available)

All of them: just connect your GitHub repo and set the environment variables.
