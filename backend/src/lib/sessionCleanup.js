'use strict';
/**
 * sessionCleanup.js
 * Runs on a schedule — checks radreply for expired Session-Timeout
 * and revokes any MACs whose sessions have expired.
 * Also cross-checks iptables authorized_clients chain.
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { revokeAccess } = require('./radius');
const { getDb } = require('../db/migrate');

async function cleanupExpiredSessions() {
  const db = getDb();

  try {
    // Find sessions that have expired (expires_at < now)
    const expired = db.prepare(`
      SELECT mac_address FROM sessions
      WHERE access_granted = 1
        AND expires_at IS NOT NULL
        AND expires_at < datetime('now')
        AND mac_address IS NOT NULL
    `).all();

    if (expired.length === 0) {
      db.close();
      return;
    }

    console.log(`[CLEANUP] Found ${expired.length} expired session(s)`);

    for (const row of expired) {
      try {
        console.log(`[CLEANUP] Revoking expired session: ${row.mac_address}`);
        await revokeAccess(row.mac_address);

        // Mark session as revoked in SQLite
        db.prepare(`
          UPDATE sessions
          SET access_granted = 0, expires_at = NULL, updated_at = datetime('now')
          WHERE mac_address = ? AND access_granted = 1
        `).run(row.mac_address);

      } catch (err) {
        console.error(`[CLEANUP] Failed to revoke ${row.mac_address}:`, err.message);
      }
    }
  } finally {
    db.close();
  }
}

async function cleanupOrphanedIptablesRules() {
  // Get MACs currently in iptables authorized_clients chain
  try {
    const { stdout } = await execAsync('sudo iptables -L authorized_clients -n');
    const lines = stdout.split('\n').filter(l => l.includes('MAC'));
    const iptablesMacs = lines.map(l => {
      const match = l.match(/MAC ([0-9a-f:]{17})/i);
      return match ? match[1].toLowerCase() : null;
    }).filter(Boolean);

    if (iptablesMacs.length === 0) return;

    // Check each against SQLite — if no active session, revoke
    const db = getDb();
    for (const mac of iptablesMacs) {
      const session = db.prepare(`
        SELECT id FROM sessions
        WHERE mac_address = ?
          AND access_granted = 1
          AND expires_at > datetime('now')
      `).get(mac);

      if (!session) {
        console.log(`[CLEANUP] Orphaned iptables rule for ${mac} — revoking`);
        await revokeAccess(mac);
      }
    }
    db.close();
  } catch (err) {
    console.error('[CLEANUP] iptables check failed:', err.message);
  }
}

module.exports = { cleanupExpiredSessions, cleanupOrphanedIptablesRules };