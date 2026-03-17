'use strict';
/**
 * radius.js — CoovaChilli edition
 * Grant/revoke via MariaDB (FreeRADIUS) + chilli_query
 *
 * Socket path: /var/run/chilli.ipc  (not chilli*.sock)
 * chilli_query returns "Timeout" when no clients connected — this is normal.
 */

const mysql     = require('mysql2/promise');
const { exec }  = require('child_process');
const util      = require('util');
const execAsync = util.promisify(exec);

// ── MAC helpers ───────────────────────────────────────────────────────────

function normalizeMac(mac) {
  if (!mac) throw new Error('MAC address required');
  const hex = mac.toUpperCase().replace(/[^A-F0-9]/g, '');
  if (hex.length !== 12) throw new Error(`Invalid MAC: ${mac}`);
  return hex.match(/.{2}/g).join(':');
}

// ── MySQL pool ────────────────────────────────────────────────────────────

let _pool = null;
function pool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host:               process.env.RADIUS_DB_HOST || 'localhost',
      user:               process.env.RADIUS_DB_USER || 'radius',
      password:           process.env.RADIUS_DB_PASS,
      database:           'radius',
      port:               parseInt(process.env.RADIUS_DB_PORT || '3306'),
      waitForConnections: true,
      connectionLimit:    10,
      queueLimit:         0,
    });
  }
  return _pool;
}

// ── CoovaChilli helpers ───────────────────────────────────────────────────

// Socket path confirmed in production: /var/run/chilli.ipc
// NOT /var/run/chilli*.sock — that glob matches nothing on this build
const CHILLI_CMD = process.env.CHILLI_QUERY_CMD
  || 'sudo chilli_query -s /var/run/chilli.ipc';

  async function chilliAuthorize(mac, timeoutSeconds = 3600) {
    try {
      // chilli_query 1.8 syntax: named keyword arguments
      // 'authorize' requires 'mac' keyword, NOT positional MAC
      const cmd = `${CHILLI_CMD} authorize mac ${mac} sessiontimeout ${timeoutSeconds}`;
      const { stdout, stderr } = await execAsync(cmd);
      const out = (stdout || stderr || '').trim();
      if (out && !out.toLowerCase().includes('unknown')) {
        console.log(`[CHILLI] authorize ${mac}: ${out}`);
      } else if (out) {
        console.warn(`[CHILLI] authorize warning for ${mac}: ${out}`);
      } else {
        console.log(`[CHILLI] authorize ${mac}: ok`);
      }
    } catch (err) {
      console.warn(`[CHILLI] authorize failed for ${mac}: ${err.message}`);
    }
  }

  async function chilliDeauthorize(mac) {
    try {
      // Use 'logout' command with mac keyword — 'deauthorize' may not exist in 1.8
      const cmd = `${CHILLI_CMD} logout mac ${mac}`;
      const { stdout, stderr } = await execAsync(cmd);
      console.log(`[CHILLI] logout ${mac}: ${(stdout || stderr || 'ok').trim()}`);
    } catch (err) {
      console.warn(`[CHILLI] logout failed for ${mac}: ${err.message}`);
    }
  }
// ── Public API ────────────────────────────────────────────────────────────

async function grantAccess(mac, hours = 1, clientIp = null) {
  const normMac = normalizeMac(mac);           // colon: 08:31:8B:90:50:F8
  const dashMac = normMac.replace(/:/g, '-');  // dash:  08-31-8B-90-50-F8
  const timeout = hours * 3600;
  const db = pool();

  // Insert BOTH formats — chilli sends dash format to RADIUS
  for (const username of [normMac, dashMac]) {
    await db.execute(
      `INSERT INTO radcheck (username, attribute, op, value)
         VALUES (?, 'Auth-Type', ':=', 'Accept')
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [username]
    );
    await db.execute(
      `INSERT INTO radreply (username, attribute, op, value)
         VALUES (?, 'Session-Timeout', ':=', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [username, String(timeout)]
    );
  }

  await chilliAuthorize(normMac, timeout, clientIp);

  console.log(`✅ Access granted: ${normMac} | hours=${hours}`);
  return { ok: true, mock: false, mac: normMac };
}

async function revokeAccess(mac) {
  const normMac = normalizeMac(mac);
  const dashMac = normMac.replace(/:/g, '-');
  const db = pool();

  // Remove both formats
  for (const username of [normMac, dashMac]) {
    await db.execute('DELETE FROM radcheck WHERE username = ?', [username]);
    await db.execute('DELETE FROM radreply  WHERE username = ?', [username]);
  }

  await chilliDeauthorize(normMac);
  console.log(`🗑 Access revoked: ${normMac}`);
  return { ok: true };
}
async function testConnection() {
  try {
    const db = pool();
    const [[row]] = await db.execute('SELECT COUNT(*) AS n FROM radcheck');
    return { ok: true, authorizedMacs: row.n, host: process.env.RADIUS_DB_HOST || 'localhost' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function listAuthorizedClients() {
  try {
    const { stdout } = await execAsync(`${CHILLI_CMD} list`);
    if (!stdout || stdout.includes('Timeout')) return [];
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return { mac: parts[0], ip: parts[1] };
    });
  } catch {
    return [];
  }
}

function buildLogoutUrl(_mac) {
  return { url: null, note: 'Revoke via chilli_query — call revokeAccess(mac) directly' };
}

module.exports = {
  grantAccess,
  revokeAccess,
  testConnection,
  listAuthorizedClients,
  buildLogoutUrl,
  normalizeMac,
};