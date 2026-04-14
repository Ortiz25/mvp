'use strict';
/**
 * sessionCleanup.js — CoovaChilli edition
 *
 * Runs every 60 seconds:
 *   1. deactivateExpiredCampaigns() — sets active=0 on campaigns whose
 *      end_date has passed, identical effect to pressing Deactivate in admin.
 *   2. cleanupExpiredSessions()     — revokes MACs whose sessions have expired.
 *
 * CoovaChilli enforces Session-Timeout at the network layer independently —
 * this job reconciles the SQLite DB and calls chilli_query deauthorize as
 * belt-and-suspenders.
 *
 * IMPORTANT: expires_at is intentionally preserved after revocation.
 * Setting it to NULL was the original behaviour, but it caused sessions to
 * show as "Pending" in the admin dashboard after cleanup — indistinguishable
 * from sessions that were never granted. We now keep expires_at intact and
 * use access_granted=0 + granted_at IS NOT NULL to mean "was active, now
 * expired". The Sessions page uses granted_at to determine true status.
 */

const { revokeAccess } = require('./radius');
const { getDb }        = require('../db/migrate');

function nowLocal() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ── Campaign auto-deactivation ────────────────────────────────────────────
// Sets active=0 on any campaign whose end_date has passed.
// Identical to an operator pressing the Deactivate button — the campaign
// disappears from the portal picker and stops serving immediately.
function deactivateExpiredCampaigns() {
  const db = getDb();
  try {
    const now    = nowLocal();
    const result = db.prepare(`
      UPDATE campaigns
      SET    active     = 0,
             updated_at = ?
      WHERE  active     = 1
        AND  end_date   IS NOT NULL
        AND  end_date   < ?
    `).run(now, now);

    if (result.changes > 0) {
      console.log(`[CLEANUP] ⏰ Auto-deactivated ${result.changes} expired campaign(s)`);
    }
  } finally {
    db.close();
  }
}

// ── Session expiry cleanup ────────────────────────────────────────────────
async function cleanupExpiredSessions() {
  const db = getDb();
  try {
    const now = nowLocal();

    const expired = db.prepare(`
      SELECT id, mac_address, expires_at FROM sessions
      WHERE access_granted = 1
        AND expires_at IS NOT NULL
        AND expires_at < ?
        AND mac_address IS NOT NULL
    `).all(now);

    if (expired.length === 0) { db.close(); return; }

    console.log(`[CLEANUP] Revoking ${expired.length} expired session(s)`);

    for (const row of expired) {
      try {
        await revokeAccess(row.mac_address);
        // Preserve expires_at so the Sessions dashboard can show the correct
        // expiry time and distinguish "Expired" from "Pending (never granted)".
        // Only access_granted is zeroed — expires_at stays as a historical record.
        db.prepare(`
          UPDATE sessions
          SET access_granted = 0,
              updated_at     = ?
          WHERE id = ?
        `).run(now, row.id);
        console.log(`[CLEANUP] ✅ Revoked: ${row.mac_address}`);
      } catch (err) {
        console.error(`[CLEANUP] Failed: ${row.mac_address}`, err.message);
      }
    }
  } finally {
    db.close();
  }
}

module.exports = { cleanupExpiredSessions, deactivateExpiredCampaigns };
