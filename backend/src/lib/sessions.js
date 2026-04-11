'use strict';
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/migrate');

// ── Shared DB connection for high-frequency heartbeat writes ──────────────
let _sharedDb = null;
function getSharedDb() {
  if (!_sharedDb || !_sharedDb.open) _sharedDb = getDb();
  return _sharedDb;
}

// ── Session lookup cache — prevents DB storm on rapid /status calls ───────
// After session expiry the frontend can fire dozens of /status calls per second
// (Shell poll interval restarting). Without this, every call hits SQLite
// simultaneously causing lock contention and 500 errors.
// Cache: MAC+campaignId → { session, ts }. TTL = 2 seconds.
const _sessionCache = new Map();
const SESSION_CACHE_TTL = 2000; // ms

function getCachedSession(key) {
  const entry = _sessionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SESSION_CACHE_TTL) {
    _sessionCache.delete(key);
    return null;
  }
  return entry.session;
}

function setCachedSession(key, session) {
  _sessionCache.set(key, { session, ts: Date.now() });
  // Prune old entries to prevent memory leak
  if (_sessionCache.size > 500) {
    const cutoff = Date.now() - SESSION_CACHE_TTL * 5;
    for (const [k, v] of _sessionCache) {
      if (v.ts < cutoff) _sessionCache.delete(k);
    }
  }
}

function invalidateCache(mac, campaignId) {
  // Called after grant/watch/survey to ensure next /status reads fresh from DB
  if (mac) _sessionCache.delete(`${mac}:${campaignId}`);
}

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
      // Always create a new session when the grant has expired — even on the same
      // calendar day. The new session will have video_watched=1 if they already
      // watched today, so they skip the video and go straight to grant/survey.
      // Without this, the expired session is reused with video_watched=1, which
      // causes VideoPage to redirect back to PickerPage with dismissedSlug set,
      // making the campaign disappear from the list.
      //
      // "Same day = skip re-watch" is enforced separately in VideoPage by
      // checking video_watched on the new session.
      //
      // Original EAT timezone note: Both sides use local-time methods.
      //
      // IMPORTANT: Both sides must use the same timezone.
      // granted_at is stored as "YYYY-MM-DD HH:MM:SS" local time by markAccessGranted()
      // using JS local-time methods (getFullYear/getMonth/getDate).
      //
      // DO NOT use toLocaleDateString('en-CA') — on Node.js without full ICU data
      // (default on Raspberry Pi OS), Intl uses UTC regardless of TZ env var.
      // In EAT (UTC+3) this creates a 3-hour window (00:00–03:00 EAT) where the
      // UTC date is still yesterday, causing false "already watched" pop-ups.
      //
      // Fix: build today's date string using the same local-time methods.
      const grantDate = existingSession.granted_at
        ? existingSession.granted_at.slice(0, 10)
        : existingSession.created_at
          ? existingSession.created_at.slice(0, 10)
          : null;
      const now   = new Date();
      const pad   = n => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      // Always create a new session — either different day (must re-watch)
      // or same day expired (skip re-watch but need fresh grant).
      // The new session carries video_watched from below.
      return true;
    }

    case 'once_ever':
      // User never re-watches, but DOES need a new session to get a new grant
      // when their previous one expires. New session is created with
      // video_watched=1, survey_done=1 so they skip straight to grant.
      return true;

    default:
      return false;
  }
}

// challenge = CoovaChilli UAM challenge token (from loginurl params)
// campaignWatchFrequency = 'always' | 'once_per_day' | 'once_ever'
function getOrCreateSession(ip, campaignId, mac = null, dst = null, challenge = null, watchFrequency = 'once_per_day') {
  // Check in-memory cache first to prevent DB storm on rapid calls
  const cacheKey = `${mac || ip}:${campaignId}`;
  const cached = getCachedSession(cacheKey);
  if (cached) return cached;

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
      // NOTE: we do NOT flush the cache here — active sessions are safe to cache.
      // Reuse and patch mutable fields (IP may have changed via DHCP reassignment)
      db.prepare(`
        UPDATE sessions
        SET ip_address  = ?,
            mac_address = COALESCE(?, mac_address),
            updated_at  = datetime('now')
        WHERE id = ?
      `).run(ip, mac, row.id);
      db.close();
      const active = row2s({ ...row, ip_address: ip, mac_address: mac || row.mac_address });
      setCachedSession(cacheKey, active);
      return active;
    }

    // Session is expired — immediately purge it from cache so the next
    // /status call reads fresh state from DB instead of serving stale data.
    _sessionCache.delete(cacheKey);

    // Check if we need a fresh session based on watch_frequency
    if (needsNewSession(existing, watchFrequency)) {
      // Determine whether to carry forward video_watched and survey_done.
      //
      // once_ever: always carry both — user already did the engagement work.
      //
      // once_per_day: carry if the original grant was TODAY (same calendar day).
      //   Same-day expiry means they already watched today — skip re-watch.
      //   Different day means window has reset — start fresh (video_watched=0).
      let carryVideo = false, carrySurvey = false;
      if (watchFrequency === 'once_ever') {
        // once_ever: user permanently completed engagement — always carry forward
        carryVideo  = !!existing.video_watched;
        carrySurvey = !!existing.survey_done;
      } else if (watchFrequency === 'once_per_day') {
        // once_per_day: carry video_watched=1 only when the grant was on TODAY's
        // calendar date (same-day expiry = quota already used today).
        // Carrying video_watched=1 lets /status signal to PickerPage that the
        // campaign is restricted ("come back tomorrow") without routing the user
        // back through the video flow. On a different day carryVideo stays false
        // so the normal re-watch cycle runs.
        const grantDate = (existing.granted_at || existing.created_at || '').slice(0, 10);
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        if (grantDate === today && existing.video_watched) {
          carryVideo  = true;
          carrySurvey = !!existing.survey_done;
        }
        // Different day → carryVideo stays false → fresh watch required next day
      }
      const vw = carryVideo  ? 1 : 0;
      const sd = carrySurvey ? 1 : 0;
      console.log(`[SESSION] Frequency=${watchFrequency} reset for mac=${mac} — new session (video=${vw} survey=${sd})`);
      const id = uuidv4();
      db.prepare(
        `INSERT INTO sessions
           (id, campaign_id, ip_address, mac_address, dst_url, challenge,
            video_watched, survey_done, access_granted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).run(id, campaignId, ip, mac, dst, challenge, vw, sd);
      const created = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
      db.close();
      const newSession = row2s(created);
      setCachedSession(cacheKey, newSession);
      return newSession;
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
    const reused = row2s({
      ...row,
      ip_address:  ip,
      mac_address: mac       || row.mac_address,
      dst_url:     dst       || row.dst_url,
      challenge:   challenge || row.challenge,
    });
    setCachedSession(cacheKey, reused);
    return reused;
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
  const fresh = row2s(created);
  setCachedSession(cacheKey, fresh);
  return fresh;
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
  const row = db.prepare('SELECT mac_address, campaign_id FROM sessions WHERE id=?').get(id);
  db.prepare(`UPDATE sessions SET video_watched=1, updated_at=datetime('now') WHERE id=?`).run(id);
  db.close();
  if (row) invalidateCache(row.mac_address, row.campaign_id);
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
  // Invalidate cache so next /status reads the fresh granted session
  const db = getDb();
  const row = db.prepare('SELECT mac_address, campaign_id FROM sessions WHERE id=?').get(id);
  if (row) invalidateCache(row.mac_address, row.campaign_id);
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

function upsertVideoProgress(sessionId, campaignId, watchedPct, completed = false, started = false) {
  // Fix 4: use shared persistent connection — no open/close on every 5s heartbeat
  const db = getSharedDb();
  const existing = db.prepare('SELECT * FROM video_progress WHERE session_id=?').get(sessionId);
  if (!existing) {
    db.prepare(
      `INSERT INTO video_progress(id,session_id,campaign_id,watched_pct,last_pct,started,completed,updated_at)
       VALUES(?,?,?,?,?,?,?,datetime('now'))`
    ).run(uuidv4(), sessionId, campaignId, watchedPct, watchedPct, started ? 1 : 0, completed ? 1 : 0);
  } else {
    const newPct = Math.max(existing.watched_pct, watchedPct);
    db.prepare(`
      UPDATE video_progress
      SET watched_pct=?, last_pct=?, started=?, completed=?, updated_at=datetime('now')
      WHERE session_id=?
    `).run(newPct, watchedPct, started ? 1 : existing.started, completed ? 1 : existing.completed, sessionId);
  }
  // Do NOT close _sharedDb — reused across calls
}

// Fix 3: record first actual play event (fired once at 1s of playback)
function markVideoStarted(sessionId, campaignId) {
  const db = getSharedDb();
  const existing = db.prepare('SELECT id FROM video_progress WHERE session_id=?').get(sessionId);
  if (!existing) {
    db.prepare(
      `INSERT INTO video_progress(id,session_id,campaign_id,watched_pct,last_pct,started,completed,updated_at)
       VALUES(?,?,?,0,0,1,0,datetime('now'))`
    ).run(uuidv4(), sessionId, campaignId);
  } else {
    db.prepare(`UPDATE video_progress SET started=1, updated_at=datetime('now') WHERE session_id=?`).run(sessionId);
  }
}

function markVideoDropOff(sessionId) {
  // Fix 2: use shared DB; !completed guard prevents stale-session double-marking
  const db = getSharedDb();
  const row = db.prepare('SELECT * FROM video_progress WHERE session_id=?').get(sessionId);
  if (row && !row.completed && !row.dropped_off) {
    db.prepare(`
      UPDATE video_progress
      SET dropped_off=1, drop_pct=last_pct, updated_at=datetime('now')
      WHERE session_id=?
    `).run(sessionId);
  }
  // Do NOT close _sharedDb
}

function getVideoEngagementStats(campaignId = null) {
  const db     = getDb();
  const where  = campaignId ? 'WHERE vp.campaign_id=?' : '';
  const wAnd   = campaignId ? 'AND vp.campaign_id=?'   : '';
  const params = campaignId ? [campaignId] : [];

  // ── Summary ─────────────────────────────────────────────────────────────
  const summary = db.prepare(`
    SELECT
      COUNT(*)                                                                AS total_views,
      SUM(vp.started)                                                         AS started,
      COUNT(*) - SUM(vp.started)                                              AS bounce_count,
      SUM(vp.completed)                                                       AS completed,
      SUM(vp.dropped_off)                                                     AS dropped_off,
      SUM(CASE WHEN vp.started=1 AND vp.completed=0 AND vp.dropped_off=0 THEN 1 ELSE 0 END) AS still_watching,
      ROUND(CAST(COUNT(*) - SUM(vp.started) AS REAL) / NULLIF(COUNT(*), 0) * 100, 1)        AS bounce_rate,
      ROUND(AVG(vp.watched_pct) * 100, 1)                                    AS avg_watch_pct,
      ROUND(AVG(CASE WHEN vp.completed   = 1 THEN vp.watched_pct END) * 100, 1) AS avg_completion_pct,
      ROUND(AVG(CASE WHEN vp.dropped_off = 1 THEN vp.drop_pct   END) * 100, 1) AS avg_drop_pct,
      ROUND(CAST(SUM(vp.completed)   AS REAL) / NULLIF(SUM(vp.started), 0) * 100, 1)  AS completion_rate,
      ROUND(CAST(SUM(vp.dropped_off) AS REAL) / NULLIF(SUM(vp.started), 0) * 100, 1)  AS drop_rate
    FROM video_progress vp ${where}
  `).get(...params);

  // ── Daily trend (last 30 days) ───────────────────────────────────────────
  const trend = db.prepare(`
    SELECT
      DATE(vp.updated_at) AS day,
      COUNT(*)            AS views,
      SUM(vp.completed)   AS completed,
      SUM(vp.dropped_off) AS dropped
    FROM video_progress vp
    WHERE vp.updated_at >= DATE('now', '-30 days') ${wAnd}
    GROUP BY day
    ORDER BY day ASC
  `).all(...params);

  // ── Drop-off buckets ──────────────────────────────────────────────────────
  const dropBuckets = db.prepare(`
    SELECT
      CASE
        WHEN vp.drop_pct < 0.10 THEN '0-10%'
        WHEN vp.drop_pct < 0.25 THEN '10-25%'
        WHEN vp.drop_pct < 0.50 THEN '25-50%'
        WHEN vp.drop_pct < 0.75 THEN '50-75%'
        WHEN vp.drop_pct < 0.90 THEN '75-90%'
        ELSE '90-100%'
      END AS bucket,
      COUNT(*) AS count
    FROM video_progress vp
    WHERE vp.dropped_off = 1 ${wAnd}
    GROUP BY bucket
    ORDER BY MIN(vp.drop_pct)
  `).all(...params);

  // ── Completion depth buckets (how far completers watched) ─────────────────
  const completionBuckets = db.prepare(`
    SELECT
      CASE
        WHEN vp.watched_pct < 0.85 THEN 'Just passed'
        WHEN vp.watched_pct < 0.92 THEN '85-92%'
        WHEN vp.watched_pct < 0.97 THEN '92-97%'
        ELSE '97-100%'
      END AS bucket,
      COUNT(*) AS count
    FROM video_progress vp
    WHERE vp.completed = 1 ${wAnd}
    GROUP BY bucket
    ORDER BY MIN(vp.watched_pct)
  `).all(...params);

  db.close();
  return { summary, trend, dropBuckets, completionBuckets };
}

// Backward-compat alias used by existing /dropoff admin route
function getVideoDropOffStats(campaignId = null) {
  const s = getVideoEngagementStats(campaignId);
  return { ...s.summary, buckets: s.dropBuckets };
}

// ── Sweep stale "still watching" rows ────────────────────────────────────
// Any video_progress row that is not completed and not already marked as
// a drop-off, but hasn't received a heartbeat in >10 minutes, is almost
// certainly an abandoned view. Mark it as a drop-off at its last known position.
function sweepStaleVideoProgress() {
  const db = getDb();
  const stale = db.prepare(`
    SELECT id, last_pct FROM video_progress
    WHERE completed   = 0
      AND dropped_off = 0
      AND updated_at  < datetime('now', '-10 minutes')
  `).all();
  const update = db.prepare(`
    UPDATE video_progress
    SET dropped_off = 1,
        drop_pct    = last_pct,
        updated_at  = datetime('now')
    WHERE id = ?
  `);
  for (const row of stale) update.run(row.id);
  db.close();
  if (stale.length > 0) console.log(`[SWEEP] Marked ${stale.length} stale view(s) as drop-offs`);
  return stale.length;
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
  upsertVideoProgress, markVideoStarted, markVideoDropOff, getVideoDropOffStats, getVideoEngagementStats,
  invalidateCache,
  sweepStaleVideoProgress,
};