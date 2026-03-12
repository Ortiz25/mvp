'use strict';
// Load .env from backend/ directory explicitly — works regardless of PM2 cwd setting
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

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
const MOCK     = process.env.MIKROTIK_MOCK !== 'false';

// ── Bootstrap DB ───────────────────────────────────────────────────────────
migrate();

const app = express();
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────────────────────────────────────
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
    console.log(`  ${req.method} ${req.path}${req.query && Object.keys(req.query).length ? ' ?' + new URLSearchParams(req.query).toString() : ''}`);
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
  status:  'ok',
  env:     NODE_ENV,
  mock:    MOCK,
  time:    new Date().toISOString(),
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
  const hs = process.env.MIKROTIK_HOST || '192.168.88.1';
  console.log(`
╔══════════════════════════════════════════════════════╗
║   🚀  Captive Portal API  — ${IS_DEV ? 'DEV' : 'PRODUCTION'} MODE           ║
╠══════════════════════════════════════════════════════╣
║  API:       http://localhost:${PORT}                   ║
║  Health:    http://localhost:${PORT}/health             ║
║  Mode:      MikroTik Hotspot (${MOCK ? 'MOCK' : 'LIVE @ ' + hs})       ║
╚══════════════════════════════════════════════════════╝
`);
});
