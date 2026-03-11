# 💻 Local Development Guide

Test the entire captive portal stack on your laptop — **no Pi, no MikroTik, no nginx needed.**
MikroTik calls are mocked automatically; the DB is a local SQLite file.

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | ≥ 18 (LTS 20 recommended) | `node -v` |
| npm | ≥ 9 | `npm -v` |

**Install Node.js 20** if you don't have it:
```bash
# macOS (Homebrew)
brew install node@20

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Windows — download from https://nodejs.org
```

---

## First-time setup (one command)

```bash
cd captive-portal

# 1. Install all dependencies + run DB migration + seed
npm run setup
```

That single command:
- Installs packages for `backend/`, `frontend/`, and `admin/`
- Creates `backend/data/dev.db` (SQLite, auto-created)
- Seeds **3 ready-to-use campaigns**: `default`, `redcross`, `covid-health`

---

## Start the dev servers

```bash
npm run dev
```

This starts **3 processes in parallel** with colour-coded logs:

| Colour | Process | URL |
|--------|---------|-----|
| 🟢 Green  | Express API     | http://localhost:3000 |
| 🔵 Cyan   | Portal frontend | http://localhost:5173 |
| 🟣 Magenta | Admin dashboard | http://localhost:5174 |

---

## What to open in your browser

### Captive Portal (what a client sees)
```
http://localhost:5173/?campaign=default
http://localhost:5173/?campaign=redcross
http://localhost:5173/?campaign=covid-health
```
The `?campaign=` slug is sticky — once set it's saved in `sessionStorage`
so page refreshes keep the same campaign. To switch, use a new tab or clear storage.

### Admin Dashboard
```
http://localhost:5174
```
**Login token:** `dev-admin-token`
(set in `backend/.env.development` → `ADMIN_TOKEN`)

### API Health check
```
http://localhost:3000/health
```
You should see:
```json
{ "status": "ok", "env": "development", "mock": true, "time": "..." }
```
`"mock": true` confirms MikroTik calls won't hit a real router.

---

## Project structure during dev

```
captive-portal/
├── package.json          ← root: npm run dev / setup / install:all
│
├── backend/
│   ├── .env.development  ← copy this to .env for dev config
│   ├── src/
│   │   ├── index.js      ← Express entry point
│   │   ├── db/migrate.js ← schema + seed (3 campaigns auto-seeded)
│   │   ├── lib/
│   │   │   ├── campaigns.js  ← campaign/video/survey CRUD
│   │   │   ├── sessions.js   ← client session management
│   │   │   └── mikrotik.js   ← MikroTik API (mocked in dev)
│   │   └── routes/
│   │       ├── portal.js ← /api/:slug/* (public portal flow)
│   │       └── admin.js  ← /api/admin/* (token-protected)
│   └── data/dev.db       ← SQLite file (auto-created, git-ignored)
│
├── frontend/             ← Vite + React + Tailwind (portal UI)
│   └── src/lib/api.ts    ← reads ?campaign= slug from URL
│
└── admin/                ← Vite + React + Tailwind (admin UI)
```

---

## Step-by-step: copy `.env` for backend

The backend reads `.env` (not `.env.development`) so copy it once:

```bash
cp backend/.env.development backend/.env
```

`.env.development` contents (all safe defaults for laptop):
```env
NODE_ENV=development
PORT=3000
MIKROTIK_MOCK=true          # ← no real MikroTik needed
DB_PATH=./data/dev.db
MEDIA_DIR=./media
ADMIN_TOKEN=dev-admin-token
```

---

## Testing the full portal flow

1. Open **http://localhost:5173/?campaign=default**
2. Click **Get Started**
3. On the video page — tap the player area to **simulate** watching (speeds up at 5× for dev). The progress bar fills to the required 80%.
4. Click **Continue to Survey**
5. Answer all questions
6. Click **Get Internet Access** — MikroTik grant is mocked, session is saved in DB
7. See the **Success** screen with countdown timer

**To test again:** open the Admin dashboard → Sessions tab → Revoke the session, then refresh the portal.

---

## Testing the Admin dashboard

1. Open **http://localhost:5174**
2. Enter token: `dev-admin-token`

### What you can do:
- **Overview** — see stats (sessions today, conversion rate, active campaign)
- **Campaigns** — create/edit campaigns, upload video, build survey questions
- **Sessions** — see all client sessions, badge for Video/Survey done, revoke access
- **Analytics** — bar charts of survey responses per campaign

### Create a new campaign from scratch:
1. Go to **Campaigns → New Campaign**
2. Fill in name, set status to `Active`
3. Add survey questions (add/remove options per question)
4. Click **Create Campaign** — it auto-activates (pauses the previous one)
5. Refresh the portal at `localhost:5173` — new campaign loads immediately

---

## Testing with a real video file

Place any `.mp4` file in the backend media folder:

```bash
mkdir -p backend/media
cp ~/your-video.mp4 backend/media/intro.mp4
```

Then in Admin → Campaigns → Edit → upload the video file.
The portal's `<video>` tag will stream it from `http://localhost:3000/media/...`.

---

## API reference (for Postman / curl testing)

All portal routes are `/api/:slug/*`. Use `default` for the seeded campaign.

```bash
# Check session status (creates session on first call)
curl http://localhost:3000/api/default/status

# Get campaign config (video URL, survey questions)
curl http://localhost:3000/api/default/config

# Mark video watched (replace SESSION_ID from /status)
curl -X POST http://localhost:3000/api/default/video/complete \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID","watchedPct":0.85}'

# Submit survey answers
curl -X POST http://localhost:3000/api/default/survey/submit \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "SESSION_ID",
    "answers": [
      {"question_id":"Q_ID","question":"How did you hear about this?","answer":"Word of mouth"}
    ]
  }'

# Grant access (mocked — logs to console, saves to DB)
curl -X POST http://localhost:3000/api/default/access/grant \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID"}'

# Admin: list all sessions
curl http://localhost:3000/api/admin/sessions \
  -H "x-admin-token: dev-admin-token"

# Admin: get stats
curl http://localhost:3000/api/admin/stats \
  -H "x-admin-token: dev-admin-token"

# Admin: list campaigns
curl http://localhost:3000/api/admin/campaigns \
  -H "x-admin-token: dev-admin-token"
```

---

## Inspect the SQLite database directly

```bash
# Install sqlite3 CLI if needed
# macOS:  brew install sqlite
# Ubuntu: sudo apt-get install sqlite3

sqlite3 backend/data/dev.db

# Useful queries:
.tables
SELECT id, slug, name, session_hours FROM campaigns;
SELECT id, ip_address, video_watched, survey_done, access_granted FROM sessions;
SELECT question, answer, COUNT(*) FROM survey_responses GROUP BY question, answer;
.quit
```

---

## Individual service commands

```bash
# Start only the backend API
npm run dev:api

# Start only the portal frontend
npm run dev:portal

# Start only the admin dashboard
npm run dev:admin

# Re-run DB migration (wipes and re-seeds only if DB is empty)
npm run migrate

# Install deps for all three packages
npm run install:all
```

---

## Common issues

### `Cannot find module 'better-sqlite3'`
```bash
cd backend && npm install
```

### Port already in use
```bash
# Kill whatever is on port 3000
lsof -ti:3000 | xargs kill -9
# Or use different port:
PORT=3001 npm run dev:api
```

### Frontend shows "Failed to load portal"
Make sure the backend is running first (`npm run dev:api`) before opening the frontend. The Vite proxy (`/api → localhost:3000`) won't work if the API is down.

### Database locked error
Only one process should write to the DB at a time. If you see this, kill all Node processes and restart:
```bash
pkill -f "node src/index.js"
npm run dev
```

### `MIKROTIK_MOCK` is not set
The backend defaults to mock mode whenever `NODE_ENV !== 'production'`. You can also force it explicitly in `.env`:
```
MIKROTIK_MOCK=true
```

---

## When you're ready for the Pi

1. Copy the project to the Pi: `scp -r captive-portal/ pi@192.168.88.2:~/`
2. On the Pi: `bash setup.sh`
3. Edit `backend/.env` — set real `MIKROTIK_PASSWORD` and a strong `ADMIN_TOKEN`
4. Apply `mikrotik/mikrotik-config.rsc` to your MikroTik router
5. `sudo reboot`
