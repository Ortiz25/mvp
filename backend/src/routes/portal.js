'use strict';
/**
 * portal.js — public-facing portal API routes
 *
 * MAC resolution layers (in order):
 *   1. ?mac= query param (from CoovaChilli loginurl)
 *   2. ?loginurl= nested params
 *   3. chilli_query list (most reliable — chilli owns the DHCP leases)
 *   4. OS ARP table (fallback)
 */

const express = require('express');
const router  = express.Router();
const { exec } = require('child_process');

const {
  getAllCampaigns, getCampaignBySlug, getCampaignConfig,
} = require('../lib/campaigns');

const {
  getOrCreateSession, getSession,
  markVideoWatched, markSurveyDone, markAccessGranted,
  isSessionActive, getAllSessions,
} = require('../lib/sessions');

const { getDb } = require('../db/migrate');

const { grantAccess } = require('../lib/radius');

const CHILLI_IPC = process.env.CHILLI_QUERY_CMD || 'sudo chilli_query -s /var/run/chilli.ipc';
// Convert SQLite local datetime string "2026-03-20 12:00:00" to ISO format
// SQLite stores local time but new Date() parses space-separated dates as UTC
// on most JS engines, causing 3-hour offset errors in EAT (UTC+3).
// Solution: replace space with T and append local timezone offset.
function toISO(sqliteDate) {
  if (!sqliteDate) return null;
  if (sqliteDate.includes('T')) return sqliteDate; // already ISO
  // "2026-03-20 12:00:00" → "2026-03-20T12:00:00" then treat as local
  // We use a trick: parse as local by replacing space with T,
  // then output as UTC ISO so the frontend gets the right absolute time.
  const d = new Date(sqliteDate.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}



// ── Helpers ───────────────────────────────────────────────────────────────

function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.headers['x-real-ip']       || '').split(',')[0].trim() ||
    (req.socket?.remoteAddress || '').replace(/^::ffff:/, '').trim() ||
    (req.ip || '').replace(/^::ffff:/, '') ||
    null
  );
}

// Sentinel values that indicate a probe/redirect URL, not a real dst
const DST_SENTINELS = [
  'captive.local', 'captive.lan', '192.168.100.1', '192.168.182.1',
  '192.168.88.1', '192.168.88.2',
  '/gen_204', '/generate_204', '/connecttest', '/ncsi',
  '/hotspot-detect', '/canonical.html', 'hotspot/login', '/login',
  'neverssl.com', 'example.com', 'google.com',
  'generate_204', 'loggedin',
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

// Extract MAC/challenge/etc from CoovaChilli loginurl param
//   /?loginurl=http://192.168.182.1/?res=notyet&challenge=XXX&mac=YY...
function extractCoovaParams(query) {
  const result = { mac: null, ip: null, dst: null, challenge: null, chilliSid: null };
  const loginurl = query.loginurl;
  if (!loginurl) return result;
  try {
    let decoded = loginurl;
    try { decoded = decodeURIComponent(decoded); } catch {}
    try { decoded = decodeURIComponent(decoded); } catch {}
    const qstart = decoded.indexOf('?');
    if (qstart !== -1) {
      const inner = new URLSearchParams(decoded.slice(qstart + 1));
      result.mac       = inner.get('mac') || inner.get('username') || null;
      result.ip        = inner.get('ip')  || null;
      result.challenge = inner.get('challenge') || null;
      result.chilliSid = inner.get('sessionid') || null;
      const rawUserurl = inner.get('userurl') || inner.get('dst') || inner.get('link-orig') || null;
      result.dst = sanitizeDst(rawUserurl);
      console.log(`[COOVA] loginurl → mac=${result.mac} ip=${result.ip} challenge=${result.challenge ? result.challenge.slice(0,8)+'…' : null}`);
    }
  } catch (e) {
    console.warn('[COOVA] Failed to parse loginurl:', e);
  }
  return result;
}

// Tries chilli_query list first (most reliable), then OS ARP table.
function getMacForIp(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return resolve(null);

    exec(`${CHILLI_IPC} list`, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        const line = stdout.split('\n').find(l => l.includes(ip));
        if (line) {
          const parts = line.trim().split(/\s+/);
          const mac = parts[0];
          if (mac && /^[0-9a-f]{2}[-:]/i.test(mac)) {
            console.log(`[CHILLI-LIST] ${ip} → ${mac}`);
            return resolve(mac);
          }
        }
      }

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

// ── GET /api/whoami ───────────────────────────────────────────────────────
// Identifies a returning user by their IP address.
//
// Two-tier strategy:
//   Tier 1 — DB: find a granted, non-expired session for this MAC.
//            Returns the exact campaign slug + expiresAt.
//   Tier 2 — Chilli fallback: if chilli shows the session as 'pass' but
//            the DB has no granted record (e.g. device reconnected after
//            a Pi reboot, or session pre-dates the portal), we still
//            return active=true with the first active campaign slug so
//            the frontend can show the status page.
router.get('/whoami', async (req, res) => {
  const rawIp = getClientIp(req) || req.socket?.remoteAddress || '';
  const ip    = rawIp.replace(/^::ffff:/, '').trim();

  console.log(`[WHOAMI] request from ip=${ip}`);

  if (!ip || ip === '127.0.0.1' || ip === '::1') {
    return res.json({ mac: null, slug: null, active: false });
  }

  // Step 1: resolve MAC from chilli_query list or ARP
  const mac = await getMacForIp(ip);
  if (!mac) {
    console.log(`[WHOAMI] No chilli/ARP entry for ip=${ip}`);
    return res.json({ mac: null, slug: null, active: false });
  }

  console.log(`[WHOAMI] ip=${ip} → mac=${mac}`);

  try {
    const db = getDb();

    // Tier 1: DB lookup — granted non-expired session
    const row = db.prepare(`
      SELECT s.id, c.slug AS campaign_slug, s.expires_at
      FROM   sessions  s
      JOIN   campaigns c ON c.id = s.campaign_id
      WHERE  UPPER(REPLACE(s.mac_address, ':', '-')) = UPPER(REPLACE(?, ':', '-'))
        AND  s.access_granted = 1
      ORDER  BY s.created_at DESC
      LIMIT  1
    `).get(mac);

    if (row) {
      const expired = row.expires_at && new Date(toISO(row.expires_at) || row.expires_at) < new Date();
      if (!expired) {
        db.close();
        console.log(`[WHOAMI] ✓ DB hit — mac=${mac} slug=${row.campaign_slug} expires=${row.expires_at}`);
        return res.json({ mac, slug: row.campaign_slug, active: true, expiresAt: toISO(row.expires_at) });
      }
      console.log(`[WHOAMI] DB session expired at ${row.expires_at} — trying chilli fallback`);
    } else {
      console.log(`[WHOAMI] No DB granted session for mac=${mac} — trying chilli fallback`);
    }

    // Tier 2: chilli fallback — device is in 'pass' state in chilli but
    // has no DB record (reboot, pre-portal session, etc.).
    // getMacForIp already confirmed the IP is in chilli list — now verify pass state.
    const isPass = await new Promise((resolve) => {
      exec(`${CHILLI_IPC} list`, (err, stdout) => {
        if (err || !stdout) return resolve(false);
        const macNorm = mac.replace(/:/g, '-').toUpperCase();
        const line = stdout.split('\n').find(l =>
          l.includes(ip) || l.toUpperCase().includes(macNorm)
        );
        if (!line) return resolve(false);
        const parts = line.trim().split(/\s+/);
        resolve(parts[2] === 'pass');
      });
    });

    if (!isPass) {
      db.close();
      console.log(`[WHOAMI] mac=${mac} not in pass state`);
      return res.json({ mac, slug: null, active: false });
    }

    // Pick the first active campaign as fallback slug
    const campaign = db.prepare(
      'SELECT slug FROM campaigns WHERE active=1 ORDER BY created_at DESC LIMIT 1'
    ).get();
    db.close();

    const slug = campaign?.slug ?? null;
    console.log(`[WHOAMI] ✓ Chilli fallback — mac=${mac} slug=${slug}`);
    res.json({ mac, slug, active: true, expiresAt: null });

  } catch (err) {
    console.error('[WHOAMI] Error:', err.message);
    res.json({ mac: null, slug: null, active: false });
  }
});

// ── GET /api/:slug/status ─────────────────────────────────────────────────
router.get('/:slug/status', async (req, res) => {
  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const ip = req.query.ip || getClientIp(req);

  let mac       = req.query.mac || req.query.username || null;
  let challenge = req.query.challenge || null;
  let dst       = sanitizeDst(
    req.query.dst || req.query['link-orig'] || req.query.userurl || null
  );

  if ((!mac || !challenge) && req.query.loginurl) {
    const coova = extractCoovaParams(req.query);
    if (!mac)       mac       = coova.mac       || null;
    if (!challenge) challenge = coova.challenge || null;
    if (!dst)       dst       = coova.dst       || null;
  }

  if (!mac && ip) mac = await getMacForIp(ip);

  console.log(`[STATUS] slug=${req.params.slug} ip=${ip} mac=${mac} challenge=${challenge ? challenge.slice(0,8)+'…' : null}`);

  const session = getOrCreateSession(ip, c.id, mac, dst, challenge, c.watch_frequency || 'once_per_day');

  res.json({
    sessionId:      session.id,
    campaignId:     c.id,
    campaignSlug:   c.slug,
    sessionHours:   c.session_hours,
    watchFrequency: c.watch_frequency || 'once_per_day',
    videoWatched:   session.video_watched,
    surveyDone:     session.survey_done,
    accessGranted:  session.access_granted,
    active:         isSessionActive(session),
    expiresAt:      toISO(session.expires_at),
    mac:            session.mac_address,
    dst:            session.dst_url,
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