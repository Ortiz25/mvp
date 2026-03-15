'use strict';

const { revokeAccess, normalizeMac } = require('./radius');
const { getDb } = require('../db/migrate');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// ── Time helpers ──────────────────────────────────────────────────────────

function nowLocal() {
  // Returns current time as SQLite-compatible local datetime string
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ── Get MACs currently in iptables authorized_clients ─────────────────────

async function getAuthorizedMacsFromIptables() {
  try {
    const { stdout } = await execAsync('sudo iptables -L authorized_clients -n');
    return stdout.split('\n')
      .filter(l => l.includes('MAC'))
      .map(l => { const m = l.match(/MAC ([0-9a-fA-F:]{17})/); return m ? m[1].toUpperCase() : null; })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Restore iptables rules for sessions that are active in DB ─────────────

async function restoreActiveSessionRules() {
  const db = getDb();
  try {
    const now = nowLocal();
    const active = db.prepare(`
      SELECT mac_address FROM sessions
      WHERE access_granted = 1
        AND expires_at IS NOT NULL
        AND expires_at > ?
        AND mac_address IS NOT NULL
    `).all(now);

    if (active.length === 0) { db.close(); return; }

    const iptablesMacs = await getAuthorizedMacsFromIptables();

    for (const row of active) {
      const mac = normalizeMac(row.mac_address);
      if (!iptablesMacs.includes(mac)) {
        // Session is active in DB but rule is missing from iptables — restore it
        console.log(`[RESTORE] Re-adding iptables rule for active session: ${mac}`);
        try {
          await execAsync(
            `sudo iptables -I authorized_clients 1 -m mac --mac-source ${mac} -j ACCEPT`
          );
          await execAsync(
            `sudo iptables -t nat -I PREROUTING 1 -i eth1 -m mac --mac-source ${mac} -j RETURN`
          );
          console.log(`[RESTORE] ✅ Rules restored for ${mac}`);
        } catch (err) {
          console.error(`[RESTORE] Failed to restore rules for ${mac}:`, err.message);
        }
      }
    }
  } finally {
    db.close();
  }
}

// ── Revoke expired sessions ───────────────────────────────────────────────

async function cleanupExpiredSessions() {
  const db = getDb();
  try {
    const now = nowLocal();

    // Log active sessions for debugging
    const active = db.prepare(`
      SELECT mac_address, expires_at FROM sessions
      WHERE access_granted = 1 AND mac_address IS NOT NULL
    `).all();

    if (active.length > 0) {
      console.log(`[CLEANUP] Active sessions: ${active.length} | Now: ${now}`);
      active.forEach(s => {
        const expired = s.expires_at < now;
        console.log(`[CLEANUP] ${s.mac_address} expires: ${s.expires_at} ${expired ? '← EXPIRED' : '← active'}`);
      });
    }

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
      console.log(`[CLEANUP] Revoking: ${row.mac_address} (expired: ${row.expires_at})`);
      try {
        await revokeAccess(row.mac_address);
        db.prepare(`
          UPDATE sessions
          SET access_granted = 0, expires_at = NULL, updated_at = ?
          WHERE mac_address = ? AND access_granted = 1
        `).run(now, row.mac_address);
        console.log(`[CLEANUP] ✅ Revoked: ${row.mac_address}`);
      } catch (err) {
        console.error(`[CLEANUP] Failed to revoke ${row.mac_address}:`, err.message);
      }
    }
  } finally {
    db.close();
  }
}

module.exports = { cleanupExpiredSessions, restoreActiveSessionRules };