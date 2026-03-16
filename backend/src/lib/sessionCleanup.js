'use strict';
/**
 * sessionCleanup.js — CoovaChilli edition
 *
 * Runs every 60 seconds. Revokes MACs whose sessions have expired in SQLite.
 * CoovaChilli enforces Session-Timeout at the network layer independently —
 * this job reconciles the SQLite DB and calls chilli_query deauthorize as
 * belt-and-suspenders.
 *
 * restoreActiveSessionRules() is NOT needed — CoovaChilli starts fresh on
 * every restart. Clients re-authenticate after a Pi reboot.
 */

const { revokeAccess } = require('./radius');
const { getDb }        = require('../db/migrate');

function nowLocal() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function cleanupExpiredSessions() {
  const db = getDb();
  try {
    const now = nowLocal();

    const expired = db.prepare(`
      SELECT mac_address, expires_at FROM sessions
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
        db.prepare(`
          UPDATE sessions
          SET access_granted = 0, expires_at = NULL, updated_at = ?
          WHERE mac_address = ? AND access_granted = 1
        `).run(now, row.mac_address);
        console.log(`[CLEANUP] ✅ Revoked: ${row.mac_address}`);
      } catch (err) {
        console.error(`[CLEANUP] Failed: ${row.mac_address}`, err.message);
      }
    }
  } finally {
    db.close();
  }
}

module.exports = { cleanupExpiredSessions };