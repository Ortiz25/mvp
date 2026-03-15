'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { cleanupExpiredSessions, cleanupOrphanedIptablesRules } = require('./lib/sessionCleanup');

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

// Run cleanup every 60 seconds
setInterval(async () => {
  console.log('[Routine] Running session cleanup every 60 secs...');
  await cleanupExpiredSessions();
  await cleanupOrphanedIptablesRules();
}, 60 * 1000);

// Also run once on startup to catch any sessions that expired during downtime
setTimeout(async () => {
  console.log('[STARTUP] Running session cleanup...');
  await cleanupExpiredSessions();
  await cleanupOrphanedIptablesRules();
}, 5000);

const app = express();
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({
  origin: IS_DEV
    ? true
    : (process.env.CORS_ORIGINS || 'http://captive.local').split(','),
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
