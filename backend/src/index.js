'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

const { migrate } = require('./db/migrate');
const portalRouter = require('./routes/portal');
const adminRouter  = require('./routes/admin');

const PORT     = process.env.PORT;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_DEV   = NODE_ENV !== 'production';

// ── Bootstrap DB ───────────────────────────────────────────────────────────
migrate();

const app = express();
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────────────────────────────────────
app.use(cors({
  origin: IS_DEV
    ? true   // allow everything in dev (localhost:5173, localhost:5174)
    : (process.env.CORS_ORIGINS || 'http://captive.local').split(','),
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','x-admin-token'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (IS_DEV) {
  // Colourful request logging in dev
  app.use((req, _res, next) => {
    console.log(`  ${req.method} ${req.path}`);
    next();
  });
}

// ── Rate limiting (relaxed in dev) ────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_DEV ? 9999 : 150,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Static: uploaded media files ──────────────────────────────────────────
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '../media');
app.use('/media', express.static(MEDIA_DIR));
app.use('/uploads', express.static(MEDIA_DIR));   // alias used by frontend

// ── Captive portal OS detection endpoints ─────────────────────────────────
// These are what iOS / Android / Windows hit to detect a captive portal.
// In dev they just return a helpful message; in prod nginx handles some of them.
app.get('/generate_204',        (_q, r) => r.status(204).send());
app.get('/gen_204',             (_q, r) => r.status(204).send());
app.get('/hotspot-detect.html', (_q, r) => r.send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>'));
app.get('/ncsi.txt',            (_q, r) => r.type('text').send('Microsoft NCSI'));

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:  'ok',
  env:     NODE_ENV,
  mock:    process.env.MIKROTIK_MOCK !== 'false',
  time:    new Date().toISOString(),
}));

// ── API routes ────────────────────────────────────────────────────────────
// Portal routes: /api/:slug/status, /api/:slug/config, etc.
app.use('/api', portalRouter);

// Admin routes: /api/admin/*  (token-protected)
app.use('/api/admin', adminRouter);

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (IS_DEV) console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🚀  Captive Portal API  — DEV MODE        ║
╠══════════════════════════════════════════════╣
║  API:      http://localhost:${PORT}             ║
║  Health:   http://localhost:${PORT}/health      ║
║  MikroTik: MOCK (no router needed)           ║
╚══════════════════════════════════════════════╝

  Seeded campaigns:
    → http://localhost:5173/?campaign=default
    → http://localhost:5173/?campaign=redcross
    → http://localhost:5173/?campaign=covid-health

  Admin dashboard:
    → http://localhost:5174   (token: dev-admin-token)
`);
});
