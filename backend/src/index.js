'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { cleanupExpiredSessions, deactivateExpiredCampaigns } = require('./lib/sessionCleanup');
const { sweepStaleVideoProgress } = require('./lib/sessions');
const servicesRouter = require('./routes/services');

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const { migrate }    = require('./db/migrate');
const portalRouter   = require('./routes/portal');
const adminRouter    = require('./routes/admin');

const PORT     = process.env.PORT     || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_DEV   = NODE_ENV !== 'production';

// ── Bootstrap DB ──────────────────────────────────────────────────────────
migrate();

// Run once immediately on startup so expired campaigns are deactivated
// before the first request is served — no waiting for the first interval tick.
deactivateExpiredCampaigns();
sweepStaleVideoProgress(); // classify any views abandoned before last restart

// Every 30 seconds: sweep stale video_progress rows.
// Threshold inside sweepStaleVideoProgress is 2 minutes — running the sweep
// every 30s ensures Android native WebView drop-offs (no beacon, no pagehide)
// are recorded within ~2.5 minutes of the user closing the portal window.
setInterval(() => {
  sweepStaleVideoProgress();
}, 30 * 1000);

// Every 60 seconds:
//   1. Auto-deactivate campaigns whose end_date has passed
//   2. Revoke expired client sessions from chilli + RADIUS DB
setInterval(async () => {
  deactivateExpiredCampaigns();
  await cleanupExpiredSessions();
}, 60 * 1000);

const app = express();
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({
  origin: IS_DEV
    ? true
    : (process.env.CORS_ORIGINS || 'http://captive.lan,http://captive.local').split(','),
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-token'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (IS_DEV) {
  app.use((req, _res, next) => {
    console.log(`  ${req.method} ${req.path}`);
    next();
  });
}

// ── Rate limiting ─────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_DEV ? 9999 : 200,
  standardHeaders: true,
  legacyHeaders:   false,
}));

// ── Static media ──────────────────────────────────────────────────────────
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '../media');
app.use('/media',   express.static(MEDIA_DIR));
app.use('/uploads', express.static(MEDIA_DIR));
app.use('/api/services', servicesRouter);

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  env:    NODE_ENV,
  auth:   'RADIUS',
  time:   new Date().toISOString(),
}));

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api',       portalRouter);
app.use('/api/admin', adminRouter);

// ── 404 / error ───────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  if (IS_DEV) console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   🚀  CityNet Captive Portal — RADIUS Edition        ║
╠══════════════════════════════════════════════════════╣
║  API:    http://localhost:${PORT}                      ║
║  Health: http://localhost:${PORT}/health               ║
║  Auth:   FreeRADIUS + MySQL                          ║
╚══════════════════════════════════════════════════════╝
`);
});