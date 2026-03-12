'use strict';
/**
 * Portal routes — MikroTik Hotspot edition
 *
 * MikroTik Hotspot injects these query params when redirecting to the portal:
 *   ?mac=XX:XX:XX:XX:XX:XX  — client MAC address
 *   ?ip=192.168.88.x        — client IP
 *   ?username=XX:XX:XX...   — same as mac (default Hotspot config)
 *   ?dst=http://...         — original URL the client was trying to reach
 *   ?identity=RouterName    — router identity string
 *
 * Access grant flow:
 *   1. Frontend calls POST /api/:slug/access/grant
 *   2. Backend marks session as granted in DB
 *   3. Backend returns { hotspotLoginUrl } — the MikroTik login URL
 *   4. Frontend does window.location.replace(hotspotLoginUrl)
 *   5. MikroTik receives the GET from the client browser, authenticates
 *      the MAC by username=mac&password=mac, then redirects to dst
 *
 * IMPORTANT: Step 5 only works if:
 *   a) The hotspot profile has login-by=mac, mac-auth-mode=mac-as-username-and-password
 *   b) The walled garden allows dst-address=192.168.88.1 pre-auth
 *   c) The browser actually reaches 192.168.88.1/login (not intercepted by WebView)
 */
const express = require('express');
const router  = express.Router();

const { buildLoginUrl }  = require('../lib/mikrotik');
const { getAllCampaigns, getCampaignBySlug, getCampaignConfig } = require('../lib/campaigns');
const {
  getOrCreateSession, getSession, isSessionActive,
  markVideoWatched, markSurveyDone, markAccessGranted,
} = require('../lib/sessions');

// Real IP behind nginx proxy
const clientIp = req =>
  ((req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip || '0.0.0.0')
    .split(',')[0].trim());

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

  const ip  = req.query.ip  || clientIp(req);
  const mac = req.query.mac || req.query.username || null;
  const rawDstParam = req.query.dst || req.query['link-orig'] || null;

  function sanitizeDst(raw) {
    if (!raw) return null;
    let d = raw;
    try { d = decodeURIComponent(d); } catch {}
    try { d = decodeURIComponent(d); } catch {}
    const bad = [
      'captive.local', '192.168.88.1/login', '192.168.88.2',
      '/gen_204', '/generate_204', '/connecttest', '/ncsi',
      '/hotspot-detect', '/canonical.html', 'hotspot/login',
    ];
    if (bad.some(b => d.includes(b))) return null;
    if (!d.startsWith('http')) return null;
    return d;
  }
  const dst = sanitizeDst(rawDstParam);

  console.log(`[STATUS] slug=${req.params.slug} ip=${ip} mac=${mac} dst=${dst} raw_dst=${rawDstParam}`);

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
      id: v.id, title: v.title, description: v.description,
      url:          `/media/${c.id}/${v.filename}`,
      thumbnailUrl: v.thumbnail_filename ? `/media/${c.id}/${v.thumbnail_filename}` : null,
      durationSeconds:  v.duration_seconds,
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

  const session  = getSession(sessionId);
  if (!session)  return res.status(404).json({ error: 'Session not found' });

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
  if (!session)           return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!answers?.length)       return res.status(400).json({ error: 'Answers required' });

  markSurveyDone(sessionId, answers);
  res.json({ success: true });
});

// ── POST /api/:slug/access/grant ──────────────────────────────────────────
// Returns the MikroTik Hotspot login URL for the frontend to redirect to.
// The browser visiting that URL is what actually grants internet access.
//
// FIX: We ALWAYS call markAccessGranted here — even if the session was already
// marked. This handles the case where the browser bounces back to captive.local
// after the MikroTik redirect (Android WebView behaviour), causing a second
// grant call. The DB update is idempotent (just refreshes expires_at).
router.post('/:slug/access/grant', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = getSession(sessionId);
  if (!session)               return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!session.survey_done)   return res.status(403).json({ error: 'Must complete survey first' });

  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  // Always mark granted — idempotent, safe to call multiple times
  markAccessGranted(sessionId, c.session_hours);

  const mac = session.mac_address;
  const SUCCESS = process.env.SUCCESS_REDIRECT || 'http://www.google.com';

  // Strip captive portal detection probe URLs — these are not real pages.
  // MikroTik sometimes passes /generate_204 or similar as the dst when a
  // device triggers the portal via a connectivity check rather than real browsing.
  const PROBE_PATTERNS = [
    '/gen_204', '/generate_204', '/connecttest', '/ncsi',
    '/hotspot-detect', '/canonical.html', '/success.txt',
    'hotspot/login', 'captive.local',
  ];
  const rawDst = session.dst_url || '';
  const isProbe = !rawDst || PROBE_PATTERNS.some(p => rawDst.includes(p));
  const dst = isProbe ? SUCCESS : rawDst;

  console.log(`🎯 Grant: mac=${mac || 'none'} raw_dst="${rawDst}" isProbe=${isProbe} using="${dst}"`);

  // Build the URL the browser needs to visit to authenticate with MikroTik.
  // Format: http://192.168.88.1/login?username=MAC&password=MAC&dst=URL
  // MikroTik matches username+password against its MAC auth table, grants the
  // client's IP, then HTTP 302 redirects to dst.
  const { url: hotspotLoginUrl, mock } = buildLoginUrl(mac, dst);

  const expiresAt = new Date(Date.now() + c.session_hours * 3600000).toISOString();

  console.log(`🌐 Access granted: mac=${mac || 'none'} campaign=${c.slug} hours=${c.session_hours} mock=${mock} loginUrl=${hotspotLoginUrl}`);

  res.json({
    success:       true,
    expiresAt,
    hotspotLoginUrl,  // frontend does: window.location.replace(hotspotLoginUrl)
    mock,
  });
});

module.exports = router;
