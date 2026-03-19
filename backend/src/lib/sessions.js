'use strict';
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/migrate');

function row2s(r) {
  return {
    id:            r.id,
    campaign_id:   r.campaign_id,
    mac_address:   r.mac_address   || null,
    ip_address:    r.ip_address,
    dst_url:       r.dst_url       || null,
    challenge:     r.challenge     || null,
    video_watched: r.video_watched === 1,
    survey_done:   r.survey_done   === 1,
    access_granted:r.access_granted=== 1,
    granted_at:    r.granted_at    || null,
    expires_at:    r.expires_at    || null,
    created_at:    r.created_at,
    updated_at:    r.updated_at,
  };
}

// ── Watch frequency helpers ───────────────────────────────────────────────
//
// watch_frequency controls when a MAC must re-watch the video + survey:
//
//   always       — must watch on every single grant request
//   once_per_day — must watch once per calendar day (local time)
//                  after that, additional top-ups that day skip video/survey
//   once_ever    — watch once per MAC per campaign, never again
//
// Implementation: instead of reusing the old session record (which carries
// video_watched=true from a previous cycle), we create a NEW session when
// the frequency window has reset. The old session is preserved for analytics.
// The new session starts with video_watched=0, survey_done=0, so the portal
// flow runs again correctly.

function needsNewSession(existingSession, watchFrequency) {
  if (!existingSession) return false; // no existing session, will create fresh
  if (!existingSession.video_watched) return false; // hasn't watched yet, keep existing

  switch (watchFrequency) {
    case 'always':
      // Must watch every time — always create a fresh session
      return true;

    case 'once_per_day': {
      // Must watch once per calendar day.
      // If the last video watch was on a previous calendar day → fresh session.
      // We use created_at of the session as the proxy for "watch day" since
      // a session with video_watched=true was completed on its created_at day.
      const sessionDate = existingSession.created_at
        ? existingSession.created_at.slice(0, 10) // "2026-03-19"
        : null;
      const today = new Date().toLocaleDateString('en-CA'); // "2026-03-19" local
      return sessionDate !== today;
    }

    case 'once_ever':
      // Watch once ever — reuse the existing session indefinitely
      return false;

    default:
      return false;
  }
}

// challenge = CoovaChilli UAM challenge token (from loginurl params)
// campaignWatchFrequency = 'always' | 'once_per_day' | 'once_ever'
function getOrCreateSession(ip, campaignId, mac = null, dst = null, challenge = null, watchFrequency = 'once_per_day') {
  const db = getDb();
  let row;

  // Look up existing session by MAC first (most reliable), then IP
  if (mac) row = db.prepare(
    'SELECT * FROM sessions WHERE mac_address=? AND campaign_id=? ORDER BY created_at DESC LIMIT 1'
  ).get(mac, campaignId);

  if (!row) row = db.prepare(
    'SELECT * FROM sessions WHERE ip_address=? AND campaign_id=? ORDER BY created_at DESC LIMIT 1'
  ).get(ip, campaignId);

  if (row) {
    const existing = row2s(row);

    // Check if we need a fresh session based on watch_frequency
    if (needsNewSession(existing, watchFrequency)) {
      // Frequency window has reset — create a new session so video/survey
      // run again. The old session record is kept for analytics.
      console.log(`[SESSION] Frequency=${watchFrequency} reset for mac=${mac} — creating fresh session`);
      const id = uuidv4();
      db.prepare(
        `INSERT INTO sessions
           (id, campaign_id, ip_address, mac_address, dst_url, challenge,
            video_watched, survey_done, access_granted)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`
      ).run(id, campaignId, ip, mac, dst, challenge);
      const created = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
      db.close();
      return row2s(created);
    }

    // Reuse existing session — update mutable fields
    db.prepare(`
      UPDATE sessions
      SET ip_address  = ?,
          mac_address = COALESCE(?, mac_address),
          dst_url     = COALESCE(?, dst_url),
          challenge   = COALESCE(?, challenge),
          updated_at  = datetime('now')
      WHERE id = ?
    `).run(ip, mac, dst, challenge, row.id);
    db.close();
    return row2s({
      ...row,
      ip_address:  ip,
      mac_address: mac       || row.mac_address,
      dst_url:     dst       || row.dst_url,
      challenge:   challenge || row.challenge,
    });
  }

  // No existing session — create fresh
  const id = uuidv4();
  db.prepare(
    `INSERT INTO sessions
       (id, campaign_id, ip_address, mac_address, dst_url, challenge,
        video_watched, survey_done, access_granted)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`
  ).run(id, campaignId, ip, mac, dst, challenge);
  const created = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  db.close();
  return row2s(created);
}

function getSession(id) {
  const db = getDb();
  const r  = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  db.close();
  return r ? row2s(r) : null;
}

function isSessionActive(s) {
  return !!(s && s.access_granted && s.expires_at && new Date(s.expires_at) > new Date());
}

function markVideoWatched(id) {
  const db = getDb();
  db.prepare(`UPDATE sessions SET video_watched=1, updated_at=datetime('now') WHERE id=?`).run(id);
  db.close();
}

function markSurveyDone(id, answers) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE sessions SET survey_done=1, updated_at=datetime('now') WHERE id=?`).run(id);
    const ins = db.prepare(
      'INSERT INTO survey_responses(id,session_id,question_id,question,answer) VALUES(?,?,?,?,?)'
    );
    for (const a of answers) ins.run(uuidv4(), id, a.question_id, a.question, a.answer);
  })();
  db.close();
}

function markAccessGranted(id, hours) {
  const db = getDb();
  const now     = new Date();
  const expires = new Date(now.getTime() + hours * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
                   `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  db.prepare(`
    UPDATE sessions
    SET access_granted = 1,
        granted_at     = ?,
        expires_at     = ?,
        updated_at     = ?
    WHERE id = ?
  `).run(fmt(now), fmt(expires), fmt(now), id);
  db.close();
}

function revokeSession(id) {
  const db = getDb();
  db.prepare(`UPDATE sessions SET access_granted=0, expires_at=NULL, updated_at=datetime('now') WHERE id=?`).run(id);
  db.close();
}

function getAllSessions(campaignId = null, limit = 100, offset = 0) {
  const db = getDb();
  const q = campaignId
    ? db.prepare(`SELECT s.*,c.name as campaign_name,c.slug as campaign_slug
                  FROM sessions s JOIN campaigns c ON s.campaign_id=c.id
                  WHERE s.campaign_id=? ORDER BY s.created_at DESC LIMIT ? OFFSET ?`).all(campaignId, limit, offset)
    : db.prepare(`SELECT s.*,c.name as campaign_name,c.slug as campaign_slug
                  FROM sessions s JOIN campaigns c ON s.campaign_id=c.id
                  ORDER BY s.created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
  db.close();
  return q.map(r => ({ ...row2s(r), campaign_name: r.campaign_name, campaign_slug: r.campaign_slug }));
}

function getStats(campaignId = null) {
  const db    = getDb();
  const where = campaignId ? `WHERE campaign_id='${campaignId}'` : '';
  const s = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN access_granted=1 AND expires_at>datetime('now') THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN survey_done=1    THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN video_watched=1  THEN 1 ELSE 0 END) as watched_video,
      SUM(CASE WHEN date(created_at)=date('now') THEN 1 ELSE 0 END) as today
    FROM sessions ${where}
  `).get();
  db.close();
  return { total: s.total||0, active: s.active||0, completed: s.completed||0, watchedVideo: s.watched_video||0, today: s.today||0 };
}

function getSurveyAggregates(campaignId = null) {
  const db    = getDb();
  const where = campaignId
    ? `WHERE sr.session_id IN (SELECT id FROM sessions WHERE campaign_id='${campaignId}')`
    : '';
  const rows = db.prepare(`
    SELECT question_id, question, answer, COUNT(*) as count
    FROM survey_responses sr ${where}
    GROUP BY question_id, answer
    ORDER BY question_id, count DESC
  `).all();
  db.close();
  const result = {};
  for (const r of rows) {
    if (!result[r.question_id]) result[r.question_id] = { question: r.question, answers: {} };
    result[r.question_id].answers[r.answer] = r.count;
  }
  return result;
}

module.exports = {
  getOrCreateSession, getSession, isSessionActive,
  markVideoWatched, markSurveyDone, markAccessGranted,
  revokeSession, getAllSessions, getStats, getSurveyAggregates,
};