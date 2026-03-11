'use strict';
const express = require('express');
const router  = express.Router();
const { getMacFromArp, grantAccess } = require('../lib/mikrotik');
const { getOrCreateSession, getSession, isSessionActive, markVideoWatched, markSurveyDone, markAccessGranted } = require('../lib/sessions');
const { getCampaignConfig, getCampaignBySlug } = require('../lib/campaigns');

const clientIp = req => ((req.headers['x-real-ip']||req.headers['x-forwarded-for']||req.ip||'0.0.0.0').split(',')[0].trim());

const { getAllCampaigns } = require('../lib/campaigns');
const { getDb } = require('../db/migrate');

// POST /api/mikrotik/resync — called by MikroTik boot scheduler (no auth needed,
// only accessible from Pi's own loopback via nginx or directly on port 3000 from LAN)
router.post('/mikrotik/resync', async (_req, res) => {
  const db  = getDb();
  const now = new Date().toISOString();
  const active = db.prepare(
    `SELECT ip_address, expires_at FROM sessions
     WHERE access_granted=1 AND expires_at > ? AND ip_address IS NOT NULL`
  ).all(now);
  db.close();

  let restored = 0, failed = 0;
  for (const s of active) {
    const hoursLeft = Math.max(0.01, (new Date(s.expires_at) - Date.now()) / 3600000);
    const r = await grantAccess(s.ip_address, null, hoursLeft);
    r.success ? restored++ : failed++;
  }

  console.log(`🔄 MikroTik resync: ${restored} restored, ${failed} failed (total ${active.length})`);
  res.json({ success: true, restored, failed, total: active.length });
});

// GET /api/campaigns  — public list for the portal picker
router.get('/campaigns', (_req, res) => {
  const campaigns = getAllCampaigns(false).map(c => ({
    id:                 c.id,
    slug:               c.slug,
    name:               c.name,
    description:        c.description || '',
    sponsor:            c.sponsor     || null,
    session_hours:      c.session_hours,
    video_filename:     c.video_filename    || null,
    video_duration:     c.video_duration    || 120,
    video_required_pct: c.video_required_pct || 0.8,
  }));
  res.json({ campaigns });
});

// GET /api/:slug/status
router.get('/:slug/status', async (req, res) => {
  const c = getCampaignBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const ip=clientIp(req), mac=await getMacFromArp(ip);
  const session=getOrCreateSession(ip,c.id,mac);
  res.json({ sessionId:session.id, campaignId:c.id, campaignSlug:c.slug, videoWatched:session.video_watched, surveyDone:session.survey_done, accessGranted:session.access_granted, active:isSessionActive(session), expiresAt:session.expires_at, sessionHours:c.session_hours });
});

// GET /api/:slug/config
router.get('/:slug/config', (req, res) => {
  const cfg=getCampaignConfig(req.params.slug);
  if (!cfg) return res.status(404).json({ error: 'Campaign not found or inactive' });
  const {campaign:c,video:v,survey:s}=cfg;
  res.json({
    campaign:{ id:c.id, slug:c.slug, name:c.name, description:c.description, sponsor:c.sponsor, logo_url:c.logo_url, primaryColor:c.primary_color, accentColor:c.accent_color, bgColor:c.bg_color, sessionHours:c.session_hours },
    video: v ? { id:v.id, title:v.title, description:v.description, url:`/media/${c.id}/${v.filename}`, thumbnailUrl:v.thumbnail_filename?`/media/${c.id}/${v.thumbnail_filename}`:null, durationSeconds:v.duration_seconds, requiredWatchPct:v.required_watch_pct } : null,
    survey: s ? { id:s.id, title:s.title, questions:s.questions.map(q=>({id:q.id,text:q.question,options:q.options})) } : null,
  });
});

// POST /api/:slug/video/complete
router.post('/:slug/video/complete', (req, res) => {
  const {sessionId,videoId,watchedPct}=req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const session=getSession(sessionId); if (!session) return res.status(404).json({ error: 'Session not found' });
  const cfg=getCampaignConfig(req.params.slug);
  const required=cfg?.video?.required_watch_pct||0.8;
  if ((watchedPct||0)<required) return res.status(403).json({ error:'Insufficient watch time', required, watched:watchedPct });
  markVideoWatched(sessionId);
  res.json({ success:true });
});

// POST /api/:slug/survey/submit
router.post('/:slug/survey/submit', (req, res) => {
  const {sessionId,answers}=req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const session=getSession(sessionId); if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!answers?.length)       return res.status(400).json({ error: 'Answers required' });
  markSurveyDone(sessionId,answers);
  res.json({ success:true });
});

// POST /api/:slug/access/grant
router.post('/:slug/access/grant', async (req, res) => {
  const {sessionId}=req.body; const ip=clientIp(req);
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const session=getSession(sessionId); if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.video_watched) return res.status(403).json({ error: 'Must watch video first' });
  if (!session.survey_done)   return res.status(403).json({ error: 'Must complete survey first' });
  if (isSessionActive(session)) return res.json({ success:true, alreadyActive:true, expiresAt:session.expires_at });
  const c=getCampaignBySlug(req.params.slug); if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const mk=await grantAccess(ip,sessionId,c.session_hours);
  if (!mk.success) return res.status(502).json({ error:'Network grant failed', detail:mk.error });
  markAccessGranted(sessionId,c.session_hours);
  console.log(`🌐 Access granted: ip=${ip} campaign=${c.slug} hours=${c.session_hours}`);
  res.json({ success:true, expiresAt:new Date(Date.now()+c.session_hours*3600000).toISOString(), redirectUrl:process.env.SUCCESS_REDIRECT||'http://www.google.com' });
});

module.exports = router;
