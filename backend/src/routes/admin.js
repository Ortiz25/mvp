'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { getDb }  = require('../db/migrate');
const { buildLogoutUrl, testConnection, listAuthorizedClients } = require('../lib/mikrotik');
const {
  getAllSessions, getStats, getSurveyAggregates, revokeSession, getSession,
} = require('../lib/sessions');
const {
  getAllCampaigns, getCampaignById, createCampaign, updateCampaign,
  getVideosForCampaign, createVideo, updateVideo, deleteVideo,
  getSurveyForCampaign, upsertSurvey,
} = require('../lib/campaigns');

// ── Auth middleware ───────────────────────────────────────────────────────
const TOKEN = () => process.env.ADMIN_TOKEN || 'dev-admin-token';
router.use((req, res, next) => {
  const t = req.headers['x-admin-token'] || req.query.token;
  if (t !== TOKEN()) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// ── Media upload (multer) ─────────────────────────────────────────────────
const MEDIA_ROOT = () => process.env.MEDIA_DIR || path.join(__dirname, '../../media');
const storage = multer.diskStorage({
  destination: (req, _f, cb) => {
    const d = path.join(MEDIA_ROOT(), req.params.campaignId);
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (_r, f, cb) =>
    cb(null, `${Date.now()}_${f.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_r, f, cb) =>
    /\.(mp4|webm|ogg|mov|avi|mkv|jpg|jpeg|png|gif|webp)$/i.test(path.extname(f.originalname))
      ? cb(null, true) : cb(new Error('File type not allowed')),
});

// ── Stats ─────────────────────────────────────────────────────────────────
// mikrotikActive comes from the Pi DB (active sessions) not from RouterOS API
router.get('/stats', async (req, res) => {
  const stats     = getStats(req.query.campaign || null);
  const mkClients = await listAuthorizedClients();  // mock or empty in production
  res.json({ ...stats, mikrotikActive: mkClients.length || stats.active });
});

// ── Campaigns ─────────────────────────────────────────────────────────────
router.get('/campaigns', (_req, res) =>
  res.json({ campaigns: getAllCampaigns(true) }));

router.post('/campaigns', (req, res) => {
  const { slug, name } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'slug and name required' });
  if (!/^[a-z0-9-]+$/.test(slug))
    return res.status(400).json({ error: 'slug must be lowercase alphanumeric + hyphens' });
  try {
    res.status(201).json({ campaign: createCampaign(req.body) });
  } catch (e) {
    res.status(e.message.includes('UNIQUE') ? 409 : 500).json({ error: e.message });
  }
});

router.put('/campaigns/:id', (req, res) => {
  const c = updateCampaign(req.params.id, req.body);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ campaign: c });
});

// ── Videos ────────────────────────────────────────────────────────────────
router.get('/campaigns/:campaignId/videos', (req, res) =>
  res.json({ videos: getVideosForCampaign(req.params.campaignId) }));

router.post(
  '/campaigns/:campaignId/videos',
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  (req, res) => {
    const c  = getCampaignById(req.params.campaignId);
    if (!c)  return res.status(404).json({ error: 'Campaign not found' });
    const vf = req.files['video']?.[0];
    if (!vf) return res.status(400).json({ error: 'video file required' });
    const tf = req.files['thumbnail']?.[0];
    const video = createVideo(req.params.campaignId, {
      title:             req.body.title || vf.originalname,
      description:       req.body.description,
      filename:          vf.filename,
      thumbnail_filename: tf?.filename || null,
      duration_seconds:  parseInt(req.body.duration_seconds)  || 120,
      required_watch_pct: parseFloat(req.body.required_watch_pct) || 0.8,
      sort_order:        parseInt(req.body.sort_order) || 0,
    });
    res.status(201).json({ video });
  }
);

router.put('/campaigns/:campaignId/videos/:videoId', (req, res) =>
  res.json({ video: updateVideo(req.params.videoId, req.body) }));

router.delete('/campaigns/:campaignId/videos/:videoId', (req, res) => {
  const db = getDb();
  const v  = db.prepare('SELECT * FROM campaign_videos WHERE id=?').get(req.params.videoId);
  db.close();
  if (!v) return res.status(404).json({ error: 'Not found' });
  [v.filename, v.thumbnail_filename].filter(Boolean).forEach(fn => {
    const fp = path.join(MEDIA_ROOT(), req.params.campaignId, fn);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  deleteVideo(req.params.videoId);
  res.json({ success: true });
});

// ── Media files on disk ───────────────────────────────────────────────────
router.get('/campaigns/:campaignId/media', (req, res) => {
  const dir = path.join(MEDIA_ROOT(), req.params.campaignId);
  if (!fs.existsSync(dir)) return res.json({ files: [] });
  const files = fs.readdirSync(dir).map(name => {
    const s = fs.statSync(path.join(dir, name));
    return { name, size: s.size, url: `/media/${req.params.campaignId}/${name}`, modified: s.mtime.toISOString() };
  });
  res.json({ files });
});

// ── Surveys ───────────────────────────────────────────────────────────────
router.get('/campaigns/:campaignId/survey', (req, res) =>
  res.json({ survey: getSurveyForCampaign(req.params.campaignId) }));

router.put('/campaigns/:campaignId/survey', (req, res) =>
  res.json({ survey: upsertSurvey(req.params.campaignId, req.body) }));

// ── Sessions ──────────────────────────────────────────────────────────────
router.get('/sessions', (req, res) => {
  const { campaign, limit = 50, offset = 0 } = req.query;
  res.json({ sessions: getAllSessions(campaign || null, Number(limit), Number(offset)) });
});

router.delete('/sessions/:id', async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });

  // Build MikroTik logout URL (informational — actual revoke is browser-side)
  const { url: logoutUrl } = buildLogoutUrl(s.mac_address);
  revokeSession(req.params.id);

  res.json({ success: true, logoutUrl, note: 'Session revoked in DB. Visit logoutUrl to revoke on router.' });
});

// ── Survey results ────────────────────────────────────────────────────────
router.get('/survey/results', (req, res) =>
  res.json({ aggregates: getSurveyAggregates(req.query.campaign || null) }));

// ── MikroTik status ───────────────────────────────────────────────────────
router.get('/mikrotik/status', async (_req, res) =>
  res.json(await testConnection()));

router.get('/mikrotik/clients', async (_req, res) =>
  res.json({ clients: await listAuthorizedClients() }));

module.exports = router;
