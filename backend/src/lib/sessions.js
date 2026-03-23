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
  if (!existingSession) return false;

  // Only reset the session AFTER a full grant cycle is complete.
  // Resetting on video_watched=true would interrupt the video→survey→grant
  // flow mid-way, sending the user back to the video after clicking Continue.
  // The correct trigger is access_granted=1 — the previous session is done.
  if (!existingSession.access_granted) return false;

  switch (watchFrequency) {
    case 'always':
      // Must watch every session — reset after each completed grant
      return true;

    case 'once_per_day': {
      // Reset only if the last grant was on a previous calendar day
      const grantDate = existingSession.granted_at
        ? existingSession.granted_at.slice(0, 10)
        : existingSession.created_at
          ? existingSession.created_at.slice(0, 10)
          : null;
      const today = new Date().toLocaleDateString('en-CA');
      return grantDate !== today;
    }

    case 'once_ever':
      // Never reset — reuse session forever
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

    // Never reset a session that is currently active (access_granted=1 and not expired).
    // This prevents a /status call immediately after grant — e.g. from ConnectingPage's
    // bootstrap refresh or Shell's poll — from creating a brand-new unauthenticated session
    // and bouncing the user back to the picker. The frequency window resets only after
    // the active session has fully expired.
    if (isSessionActive(existing)) {
      // Reuse and patch mutable fields (IP may have changed via DHCP reassignment)
      db.prepare(`
        UPDATE sessions
        SET ip_address  = ?,
            mac_address = COALESCE(?, mac_address),
            updated_at  = datetime('now')
        WHERE id = ?
      `).run(ip, mac, row.id);
      db.close();
      return row2s({ ...row, ip_address: ip, mac_address: mac || row.mac_address });
    }

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

// ── Video progress / drop-off tracking ────────────────────────────────────

function upsertVideoProgress(sessionId, campaignId, watchedPct, completed = false) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM video_progress WHERE session_id=?').get(sessionId);
  if (!existing) {
    db.prepare(
      `INSERT INTO video_progress(id,session_id,campaign_id,watched_pct,last_pct,completed,updated_at)
       VALUES(?,?,?,?,?,?,datetime('now'))`
    ).run(uuidv4(), sessionId, campaignId, watchedPct, watchedPct, completed ? 1 : 0);
  } else {
    // Only update watched_pct if moving forward (never rewind progress)
    const newPct = Math.max(existing.watched_pct, watchedPct);
    db.prepare(`
      UPDATE video_progress
      SET watched_pct=?, last_pct=?, completed=?, updated_at=datetime('now')
      WHERE session_id=?
    `).run(newPct, watchedPct, completed ? 1 : existing.completed, sessionId);
  }
  db.close();
}

function markVideoDropOff(sessionId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_progress WHERE session_id=?').get(sessionId);
  if (row && !row.completed && !row.dropped_off) {
    db.prepare(`
      UPDATE video_progress
      SET dropped_off=1, drop_pct=last_pct, updated_at=datetime('now')
      WHERE session_id=?
    `).run(sessionId);
  }
  db.close();
}

function getVideoDropOffStats(campaignId = null) {
  const db = getDb();
  const where = campaignId ? `WHERE campaign_id=?` : '';
  const params = campaignId ? [campaignId] : [];
  const rows = db.prepare(`
    SELECT
      COUNT(*) as total_views,
      SUM(completed) as completed,
      SUM(dropped_off) as dropped_off,
      ROUND(AVG(CASE WHEN dropped_off=1 THEN drop_pct END) * 100, 1) as avg_drop_pct,
      ROUND(AVG(watched_pct) * 100, 1) as avg_watch_pct
    FROM video_progress ${where}
  `).get(...params);
  // Bucket distribution: 0-10%, 10-25%, 25-50%, 50-75%, 75-90%, 90-100%
  const buckets = db.prepare(`
    SELECT
      CASE
        WHEN drop_pct < 0.10 THEN '0-10%'
        WHEN drop_pct < 0.25 THEN '10-25%'
        WHEN drop_pct < 0.50 THEN '25-50%'
        WHEN drop_pct < 0.75 THEN '50-75%'
        WHEN drop_pct < 0.90 THEN '75-90%'
        ELSE '90-100%'
      END as bucket,
      COUNT(*) as count
    FROM video_progress
    WHERE dropped_off=1 ${campaignId ? 'AND campaign_id=?' : ''}
    GROUP BY bucket
    ORDER BY MIN(drop_pct)
  `).all(...params);
  db.close();
  return { ...rows, buckets };
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
  upsertVideoProgress, markVideoDropOff, getVideoDropOffStats,
};