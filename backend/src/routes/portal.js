'use strict';
/**
 * portal.js — CoovaChilli edition
 *
 * Grant flow:
 *   1. Frontend POST /api/:slug/access/grant { sessionId }
 *   2. Backend → radius.grantAccess(mac, hours)
 *        a. INSERT into radcheck (Auth-Type = Accept)
 *        b. INSERT into radreply (Session-Timeout = seconds)
 *        c. chilli_query authorize <MAC> 0 0 <timeout>
 *   3. Frontend navigates to /connecting
 *   4. ConnectingPage navigates to http://192.168.182.1:3990/loggedin
 *   5. CoovaChilli returns real response for authorized MAC
 *   6. OS captive portal WebView dismissed
 *
 * MAC resolution order:
 *   1. ?mac= or ?username= query param (top-level — standard path)
 *   2. ?loginurl= query param — CoovaChilli wraps its redirect as:
 *      /?loginurl=http://192.168.182.1/?res=notyet&mac=XX&ip=YY&...
 *      The MAC is inside the loginurl value, not at the top level.
 *   3. Pi ARP table lookup by client IP (arp -n <ip>) — fallback
 */
const express  = require('express');
const router   = express.Router();
const { exec } = require('child_process');

const { grantAccess } = require('../lib/radius');
const { getAllCampaigns, getCampaignBySlug, getCampaignConfig } = require('../lib/campaigns');
const {
  getOrCreateSession, getSession, isSessionActive,
  markVideoWatched, markSurveyDone, markAccessGranted,
} = require('../lib/sessions');

// Sentinel values that must never be used as redirect destinations
const DST_SENTINELS = [
  'captive.local',
  '192.168.100.1',  // old iptables subnet
  '192.168.182.1',  // CoovaChilli UAM IP — never redirect back to portal
  '192.168.88.1', '192.168.88.2',
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
 * extractCoovaParams(query)
 *
 * CoovaChilli redirects unauthenticated clients to:
 *   http://192.168.182.1/?loginurl=http%3a%2f%2f192.168.182.1%2f%3f
 *     res%3dnotyet%26uamip%3d192.168.182.1%26uamport%3d3990
 *     %26mac%3d08-31-8B-90-50-F8%26ip%3d192.168.182.50
 *     %26userurl%3dhttp%253a%252f%252f...
 *
 * The MAC, IP, and original URL are inside the loginurl value.
 * This function extracts them from the nested URL.
 *
 * Note: CoovaChilli formats MAC with dashes (08-31-8B-90-50-F8).
 * normalizeMac() in radius.js handles both dash and colon formats.
 */
function extractCoovaParams(query) {
  const result = { mac: null, ip: null, dst: null };

  const loginurl = query.loginurl;
  if (!loginurl) return result;

  try {
    // loginurl may be single or double encoded
    let decoded = loginurl;
    try { decoded = decodeURIComponent(decoded); } catch {}
    try { decoded = decodeURIComponent(decoded); } catch {}

    // Parse the inner URL's query string
    const qstart = decoded.indexOf('?');
    if (qstart === -1) return result;

    const inner = new URLSearchParams(decoded.slice(qstart + 1));

    result.mac = inner.get('mac') || inner.get('username') || null;
    result.ip  = inner.get('ip')  || null;
    result.dst = sanitizeDst(
      inner.get('userurl') || inner.get('dst') || inner.get('link-orig') || null
    );

    if (result.mac) {
      console.log(`[COOVA] Extracted from loginurl — mac=${result.mac} ip=${result.ip}`);
    }
  } catch (err) {
    console.warn('[COOVA] Failed to parse loginurl:', err.message);
  }

  return result;
}

/**
 * getMacFromArp(ip)
 * Fallback MAC resolution via the Pi's ARP table.
 * Works because CoovaChilli routes all client traffic through tun0/eth1.
 */
function getMacFromArp(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return resolve(null);

    exec(`arp -n ${ip}`, (err, stdout) => {
      if (err) return resolve(null);
      const match = stdout.match(/([0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2})/i);
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
  if (!mac) return res.status(404).json({
    error: 'MAC not found in ARP table — reconnect to Wi-Fi and try again',
  });
  res.json({ mac, ip });
});

// ── GET /api/:slug/status ──────────────────────────────────────────────────
router.get('/:slug/status', async (req, res) => {
  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const ip = req.query.ip || getClientIp(req);

  // MAC resolution: top-level params → loginurl params → ARP
  let mac = req.query.mac || req.query.username || null;
  let dst = sanitizeDst(
    req.query.dst || req.query['link-orig'] || req.query.userurl || null
  );

  // CoovaChilli path — params are nested inside loginurl
  if (!mac && req.query.loginurl) {
    const coova = extractCoovaParams(req.query);
    mac = coova.mac || mac;
    dst = dst || coova.dst;
  }

  // ARP fallback
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
      thumbnailUrl: v.thumbnail_filename
        ? `/media/${c.id}/${v.thumbnail_filename}` : null,
      durationSeconds:  v.duration_seconds,
      requiredWatchPct: v.required_watch_pct,
    } : null,
    survey: s ? {
      id: s.id, title: s.title,
      questions: s.questions.map(q => ({
        id: q.id, text: q.question, options: q.options,
      })),
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
    return res.status(403).json({
      error: 'Insufficient watch time', required, watched: watchedPct,
    });
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

  // Last-chance MAC resolution via ARP
  if (!mac) {
    const ip = getClientIp(req);
    if (ip) {
      console.log(`[GRANT] No MAC in session — trying ARP for ${ip}`);
      mac = await getMacFromArp(ip);
    }
  }

  if (!mac) {
    console.error('⚠ Grant failed: no MAC for session', sessionId);
    return res.status(400).json({
      error: 'Cannot grant access: MAC address unknown. ' +
             'Please reconnect to Wi-Fi and try again.',
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