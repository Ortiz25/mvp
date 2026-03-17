'use strict';
/**
 * portal.js — CoovaChilli edition
 *
 * MAC resolution order (status + grant):
 *   1. ?mac= top-level query param
 *   2. loginurl inner params (CoovaChilli redirect path)
 *   3. chilli_query list (most reliable — chilli owns the DHCP leases)
 *   4. Pi ARP table (last resort)
 *
 * Challenge resolution order (grant):
 *   1. session.challenge — stored when loginurl was first parsed
 *   2. req.body.challenge — sent by frontend if new SessionContext deployed
 *
 * The challenge is the CoovaChilli UAM token used to compute the logon
 * response that moves a session from dnat → pass state.
 */
const express  = require('express');
const router   = express.Router();
const { exec } = require('child_process');

const { grantAccess }    = require('../lib/radius');
const { getAllCampaigns, getCampaignBySlug, getCampaignConfig } = require('../lib/campaigns');
const {
  getOrCreateSession, getSession, isSessionActive,
  markVideoWatched, markSurveyDone, markAccessGranted,
} = require('../lib/sessions');

const CHILLI_IPC = process.env.CHILLI_QUERY_CMD || 'sudo chilli_query -s /var/run/chilli.ipc';

// ── Sentinel dst values that must never be used as redirects ──────────────
const DST_SENTINELS = [
  'captive.local', '192.168.100.1', '192.168.182.1',
  '192.168.88.1', '192.168.88.2',
  '/gen_204', '/generate_204', '/connecttest', '/ncsi',
  '/hotspot-detect', '/canonical.html', 'hotspot/login', '/login',
  'neverssl.com', 'example.com', 'google.com', 'generate_204', 'loggedin',
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

// ── extractCoovaParams ────────────────────────────────────────────────────
// CoovaChilli redirects to:
//   /?loginurl=http://192.168.182.1/?res=notyet&challenge=XXX
//              &mac=08-31-8B-90-50-F8&ip=192.168.182.50
//              &sessionid=SSSS&userurl=...
// Everything we need is inside the loginurl value.
function extractCoovaParams(query) {
  const result = { mac: null, ip: null, dst: null, challenge: null, chilliSid: null };
  const loginurl = query.loginurl;
  if (!loginurl) return result;

  try {
    let decoded = loginurl;
    try { decoded = decodeURIComponent(decoded); } catch {}
    try { decoded = decodeURIComponent(decoded); } catch {}

    const qstart = decoded.indexOf('?');
    if (qstart === -1) return result;

    const inner = new URLSearchParams(decoded.slice(qstart + 1));

    result.mac       = inner.get('mac') || inner.get('username') || null;
    result.ip        = inner.get('ip')  || null;
    result.challenge = inner.get('challenge') || null;
    result.chilliSid = inner.get('sessionid') || null;
    result.dst       = sanitizeDst(
      inner.get('userurl') || inner.get('dst') || inner.get('link-orig') || null
    );

    if (result.mac || result.challenge) {
      console.log(`[COOVA] loginurl → mac=${result.mac} ip=${result.ip} challenge=${result.challenge ? result.challenge.slice(0,8)+'…' : null}`);
    }
  } catch (err) {
    console.warn('[COOVA] Failed to parse loginurl:', err.message);
  }

  return result;
}

// ── getMacForIp ───────────────────────────────────────────────────────────
// Tries chilli_query list first (most reliable), then OS ARP table.
function getMacForIp(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return resolve(null);

    // Primary: chilli_query list — chilli has the MAC from DHCP exchange
    exec(`${CHILLI_IPC} list`, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        const line = stdout.split('\n').find(l => l.includes(ip));
        if (line) {
          const parts = line.trim().split(/\s+/);
          const mac = parts[0]; // first column: MAC in dash format
          if (mac && /^[0-9a-f]{2}[-:]/i.test(mac)) {
            console.log(`[CHILLI-LIST] ${ip} → ${mac}`);
            return resolve(mac);
          }
        }
      }

      // Fallback: OS ARP table
      exec(`arp -n ${ip}`, (err2, stdout2) => {
        if (err2) return resolve(null);
        const match = stdout2.match(/([0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2})/i);
        if (match) {
          console.log(`[ARP] ${ip} → ${match[1]}`);
          return resolve(match[1]);
        }
        resolve(null);
      });
    });
  });
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

// ── GET /api/client-mac ───────────────────────────────────────────────────
router.get('/client-mac', async (req, res) => {
  const ip = getClientIp(req);
  if (!ip) return res.status(400).json({ error: 'Cannot determine client IP' });
  const mac = await getMacForIp(ip);
  if (!mac) return res.status(404).json({
    error: 'MAC not found — reconnect to Wi-Fi and try again',
  });
  res.json({ mac, ip });
});

// ── GET /api/:slug/status ─────────────────────────────────────────────────
router.get('/:slug/status', async (req, res) => {
  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const ip = req.query.ip || getClientIp(req);

  // MAC + challenge resolution — four layers
  let mac       = req.query.mac || req.query.username || null;
  let challenge = req.query.challenge || null;
  let dst       = sanitizeDst(
    req.query.dst || req.query['link-orig'] || req.query.userurl || null
  );

  // Layer 2: CoovaChilli loginurl params
  if ((!mac || !challenge) && req.query.loginurl) {
    const coova = extractCoovaParams(req.query);
    if (!mac)       mac       = coova.mac       || null;
    if (!challenge) challenge = coova.challenge || null;
    if (!dst)       dst       = coova.dst       || null;
  }

  // Layer 3: chilli_query list + ARP fallback
  if (!mac && ip) mac = await getMacForIp(ip);

  console.log(`[STATUS] slug=${req.params.slug} ip=${ip} mac=${mac} challenge=${challenge ? challenge.slice(0,8)+'…' : null}`);

  const session = getOrCreateSession(ip, c.id, mac, dst, challenge);

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

// ── POST /api/:slug/video/complete ────────────────────────────────────────
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
  const { sessionId, challenge: bodyChallenge } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = getSession(sessionId);
  if (!session)               return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!session.survey_done)   return res.status(403).json({ error: 'Must complete survey first' });

  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const clientIp = getClientIp(req);
  const hours    = c.session_hours || 1;

  // MAC resolution: session DB → chilli list → ARP
  let mac = session.mac_address;
  if (!mac && clientIp) {
    console.log(`[GRANT] No MAC in session — trying chilli list + ARP for ${clientIp}`);
    mac = await getMacForIp(clientIp);
  }

  if (!mac) {
    console.error('⚠ Grant failed: no MAC for session', sessionId);
    return res.status(400).json({
      error: 'Cannot grant access: MAC address unknown. Reconnect to Wi-Fi and try again.',
    });
  }

  // Challenge resolution: body (new frontend) → session DB (stored on status call)
  const challenge = bodyChallenge || session.challenge || null;

  if (!challenge) {
    console.warn(`[GRANT] No challenge for ${mac} — UAM logon will be skipped, chilli_query only`);
  }

  console.log(`🎯 Grant: mac=${mac} campaign=${c.slug} hours=${hours} challenge=${challenge ? challenge.slice(0,8)+'…' : 'none'}`);

  const result = await grantAccess(mac, hours, clientIp, challenge);

  markAccessGranted(sessionId, hours);
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

  console.log(`🌐 Access granted: mac=${mac} ok=${result.ok} uam=${result.uam}`);

  res.json({
    success:  true,
    granted:  result.ok,
    mock:     false,
    expiresAt,
  });
});

module.exports = router;