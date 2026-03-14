'use strict';
/**
 * portal.js — Pi-as-router edition
 *
 * Grant flow:
 *   1. Frontend POST /api/:slug/access/grant { sessionId }
 *   2. Backend → radius.grantAccess(mac, hours)
 *        a. INSERT into radcheck (Auth-Type = Accept)
 *        b. INSERT into radreply (Session-Timeout = seconds)
 *        c. iptables -I authorized_clients — opens firewall immediately
 *   3. Frontend navigates to /connecting
 *   4. ConnectingPage navigates to http://neverssl.com
 *   5. OS connectivity check passes → captive portal WebView dismissed
 *
 * MAC resolution order:
 *   1. ?mac= or ?username= query param (MikroTik hotspot substitution)
 *   2. Pi ARP table lookup by client IP (arp -n <ip>)
 */
const express = require('express');
const router  = express.Router();
const { exec } = require('child_process');

const { grantAccess } = require('../lib/radius');
const { getAllCampaigns, getCampaignBySlug, getCampaignConfig } = require('../lib/campaigns');
const {
  getOrCreateSession, getSession, isSessionActive,
  markVideoWatched, markSurveyDone, markAccessGranted,
} = require('../lib/sessions');

// Sentinel values that must never be used as redirect destinations
const DST_SENTINELS = [
  'captive.local', '192.168.100.1', '192.168.88.1', '192.168.88.2',
  '/gen_204', '/generate_204', '/connecttest', '/ncsi',
  '/hotspot-detect', '/canonical.html', 'hotspot/login', '/login',
  'neverssl.com', 'example.com', 'google.com',
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

/**
 * getMacFromArp(ip)
 * Looks up client MAC from the Pi's ARP table using `arp -n <ip>`.
 * This works because the Pi is the router — all client traffic passes through it.
 * Returns null on any failure (always non-fatal).
 */
function getMacFromArp(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return resolve(null);

    exec(`arp -n ${ip}`, (err, stdout) => {
      if (err) return resolve(null);
      // arp -n output: "192.168.100.50 ether aa:bb:cc:dd:ee:ff C eth1"
      const match = stdout.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i);
      if (match) {
        console.log(`[ARP] Resolved ${ip} → ${match[1]}`);
        return resolve(match[1]);
      }
      resolve(null);
    });
  });
}

// ── GET /api/campaigns ─────────────────────────────────────────────────────
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

// ── GET /api/client-mac ────────────────────────────────────────────────────
// Called by the React frontend on load to discover its own MAC address.
router.get('/client-mac', async (req, res) => {
  const ip = getClientIp(req);
  if (!ip) return res.status(400).json({ error: 'Cannot determine client IP' });
  const mac = await getMacFromArp(ip);
  if (!mac) return res.status(404).json({ error: 'MAC not found in ARP table — reconnect to Wi-Fi and try again' });
  res.json({ mac, ip });
});

// ── GET /api/:slug/status ──────────────────────────────────────────────────
router.get('/:slug/status', async (req, res) => {
  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const ip  = req.query.ip || getClientIp(req);
  let   mac = req.query.mac || req.query.username || null;
  const dst = sanitizeDst(req.query.dst || req.query['link-orig'] || null);

  if (!mac && ip) mac = await getMacFromArp(ip);

  console.log(`[STATUS] slug=${req.params.slug} ip=${ip} mac=${mac} dst=${dst}`);

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

// ── GET /api/:slug/config ──────────────────────────────────────────────────
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

// ── POST /api/:slug/video/complete ─────────────────────────────────────────
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

// ── POST /api/:slug/survey/submit ──────────────────────────────────────────
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

// ── POST /api/:slug/access/grant ───────────────────────────────────────────
router.post('/:slug/access/grant', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = getSession(sessionId);
  if (!session)               return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!session.survey_done)   return res.status(403).json({ error: 'Must complete survey first' });

  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  let   mac   = session.mac_address;
  const hours = c.session_hours || 1;

  // Last-chance MAC resolution via Pi ARP table
  if (!mac) {
    const ip = getClientIp(req);
    if (ip) mac = await getMacFromArp(ip);
  }

  if (!mac) {
    console.error('⚠ Grant failed: no MAC for session', sessionId);
    return res.status(400).json({
      error: 'Cannot grant access: MAC address unknown. Please reconnect to Wi-Fi and try again.',
    });
  }

  console.log(`🎯 Grant: mac=${mac} campaign=${c.slug} hours=${hours}`);

  const result = await grantAccess(mac, hours);

  markAccessGranted(sessionId, hours);
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

  console.log(`🌐 Access granted: mac=${mac} ok=${result.ok}`);

  res.json({
    success:  true,
    granted:  result.ok,
    mock:     false,
    expiresAt,
  });
});

module.exports = router;
