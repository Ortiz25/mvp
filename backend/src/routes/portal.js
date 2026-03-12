'use strict';
/**
 * Portal routes — RADIUS edition
 *
 * Grant flow:
 *   1. Frontend POST /api/:slug/access/grant { sessionId }
 *   2. Backend → radius.grantAccess(mac, hours)
 *        a. INSERT into radcheck (MAC, Cleartext-Password=password)
 *        b. INSERT into radreply (MAC, Session-Timeout=seconds)
 *        c. Fire-and-forget GET http://192.168.88.1/login?username=MAC&password=password
 *   3. Frontend navigates to /connecting
 *   4. ConnectingPage redirects to:
 *        http://192.168.88.1/login?username=MAC&password=password&dst=http://neverssl.com
 *   5. MikroTik confirms session via RADIUS → 302 → neverssl.com
 *   6. OS sees real internet → captive portal WebView dismissed
 */
const express = require('express');
const router  = express.Router();

const { grantAccess } = require('../lib/radius');  // ← RADIUS, not mikrotik
const { getAllCampaigns, getCampaignBySlug, getCampaignConfig } = require('../lib/campaigns');
const {
  getOrCreateSession, getSession, isSessionActive,
  markVideoWatched, markSurveyDone, markAccessGranted,
} = require('../lib/sessions');

// Sentinel values that must never be stored or re-used as a dst URL
const DST_SENTINELS = [
  'captive.local', '192.168.88.1', '192.168.88.2',
  '/gen_204', '/generate_204', '/connecttest', '/ncsi',
  '/hotspot-detect', '/canonical.html', 'hotspot/login', '/login',
  'neverssl.com',   // our redirect-confirm target
  'example.com',    // old redirect-confirm target
  'google.com',     // google 301→HTTPS, causes loop
];

function sanitizeDst(raw) {
  if (!raw) return null;
  let d = raw;
  try { d = decodeURIComponent(d); } catch {}
  try { d = decodeURIComponent(d); } catch {}
  if (!d.startsWith('http')) return null;
  if (DST_SENTINELS.some(b => d.includes(b))) return null;
  return d;
}

function getClientIp(req) {
  return (
    (req.headers['x-real-ip']       || '').split(',')[0].trim() ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip || null
  );
}

// ── GET /api/campaigns ────────────────────────────────────────────────────
router.get('/campaigns', (_req, res) => {
  const campaigns = getAllCampaigns(false).map(c => ({
    id:                 c.id,
    slug:               c.slug,
    name:               c.name,
    description:        c.description  || '',
    sponsor:            c.sponsor      || null,
    session_hours:      c.session_hours,
    video_filename:     c.video_filename     || null,
    video_duration:     c.video_duration     || 120,
    video_required_pct: c.video_required_pct || 0.8,
  }));
  res.json({ campaigns });
});

// ── GET /api/:slug/status ─────────────────────────────────────────────────
router.get('/:slug/status', (req, res) => {
  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const ip  = req.query.ip  || getClientIp(req);
  const mac = req.query.mac || req.query.username || null;
  const dst = sanitizeDst(req.query.dst || req.query['link-orig'] || null);

  console.log(`[STATUS] slug=${req.params.slug} ip=${ip} mac=${mac} dst=${dst} raw_dst=${req.query.dst||null}`);

  const session = getOrCreateSession(ip, c.id, mac, dst);

  res.json({
    sessionId:     session.id,
    campaignId:    c.id,
    campaignSlug:  c.slug,
    sessionHours:  c.session_hours,
    videoWatched:  session.video_watched,
    surveyDone:    session.survey_done,
    accessGranted: session.access_granted,
    active:        isSessionActive(session),
    expiresAt:     session.expires_at,
    mac:           session.mac_address,
    dst:           session.dst_url,
  });
});

// ── GET /api/:slug/config ─────────────────────────────────────────────────
router.get('/:slug/config', (req, res) => {
  const cfg = getCampaignConfig(req.params.slug);
  if (!cfg) return res.status(404).json({ error: 'Campaign not found or inactive' });
  const { campaign: c, video: v, survey: s } = cfg;
  res.json({
    campaign: {
      id: c.id, slug: c.slug, name: c.name,
      description: c.description, sponsor: c.sponsor,
      primaryColor: c.primary_color, accentColor: c.accent_color,
      sessionHours: c.session_hours,
    },
    video: v ? {
      id: v.id, title: v.title,
      url: `/media/${c.id}/${v.filename}`,
      thumbnailUrl: v.thumbnail_filename ? `/media/${c.id}/${v.thumbnail_filename}` : null,
      durationSeconds: v.duration_seconds,
      requiredWatchPct: v.required_watch_pct,
    } : null,
    survey: s ? {
      id: s.id, title: s.title,
      questions: s.questions.map(q => ({ id: q.id, text: q.question, options: q.options })),
    } : null,
  });
});

// ── POST /api/:slug/video/complete ────────────────────────────────────────
router.post('/:slug/video/complete', (req, res) => {
  const { sessionId, watchedPct } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const cfg      = getCampaignConfig(req.params.slug);
  const required = cfg?.video?.required_watch_pct || 0.8;
  if ((watchedPct || 0) < required)
    return res.status(403).json({ error: 'Insufficient watch time', required, watched: watchedPct });
  markVideoWatched(sessionId);
  res.json({ success: true });
});

// ── POST /api/:slug/survey/submit ─────────────────────────────────────────
router.post('/:slug/survey/submit', (req, res) => {
  const { sessionId, answers } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const session = getSession(sessionId);
  if (!session)               return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!answers?.length)       return res.status(400).json({ error: 'Answers required' });
  markSurveyDone(sessionId, answers);
  res.json({ success: true });
});

// ── POST /api/:slug/access/grant ──────────────────────────────────────────
router.post('/:slug/access/grant', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = getSession(sessionId);
  if (!session)               return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!session.survey_done)   return res.status(403).json({ error: 'Must complete survey first' });

  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const mac   = session.mac_address;
  const hours = c.session_hours || 1;

  console.log(`🎯 Grant: mac=${mac||'none'} campaign=${c.slug} hours=${hours}`);

  // RADIUS grant — no IP needed, no timing-sensitive active/login call
  const result = await grantAccess(mac, hours);

  if (!result.ok) {
    console.error(`⚠ RADIUS grant failed: ${result.error}`);
  }

  markAccessGranted(sessionId, hours);
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

  console.log(`🌐 Access granted: mac=${mac} campaign=${c.slug} hours=${hours} ok=${result.ok}`);

  res.json({
    success:  true,
    granted:  result.ok,
    mock:     false,
    expiresAt,
  });
});

module.exports = router;
