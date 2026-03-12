'use strict';
/**
 * radius.js — RADIUS grant/revoke via MySQL (replaces mikrotik.js)
 *
 * How it works:
 *   1. INSERT into radcheck  → tells FreeRADIUS this MAC is authorised
 *   2. INSERT into radreply  → sets Session-Timeout for the MAC
 *   3. Fire-and-forget GET to http://192.168.88.1/login?username=MAC&password=password
 *      → MikroTik re-checks RADIUS immediately and opens internet for this client
 *      → We do NOT await this — if it fails, RADIUS auth fires on the next packet (~1s)
 *
 * MAC format MUST match radius-mac-format on MikroTik hotspot profile.
 * Set:  /ip hotspot profile set hsprof1 radius-mac-format=XX:XX:XX:XX:XX:XX
 * This means uppercase, colon-separated (e.g. 8E:5A:E7:2C:58:52).
 */

const mysql = require('mysql2/promise');

// Normalise any MAC format to UPPERCASE COLON-SEPARATED
function normalizeMac(mac) {
  if (!mac) throw new Error('MAC address required');
  const hex = mac.toUpperCase().replace(/[^A-F0-9]/g, '');
  if (hex.length !== 12) throw new Error(`Invalid MAC: ${mac}`);
  return hex.match(/.{2}/g).join(':');
}

// Connection pool — created lazily on first use
let _pool = null;
function pool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host:     process.env.RADIUS_DB_HOST || 'localhost',
      user:     process.env.RADIUS_DB_USER || 'radius',
      password: process.env.RADIUS_DB_PASS,
      database: 'radius',
      port:     parseInt(process.env.RADIUS_DB_PORT || '3306'),
      waitForConnections: true,
      connectionLimit:    10,
      queueLimit:         0,
    });
  }
  return _pool;
}

const RADIUS_PASS = 'password'; // Static shared secret — not user-facing

/**
 * grantAccess(mac, hours)
 * Adds the MAC to FreeRADIUS and fires the MikroTik login trigger.
 */
async function grantAccess(mac, hours = 1) {
  const normMac = normalizeMac(mac);
  const timeout = hours * 3600;
  const db = pool();

  // 1. radcheck — upsert Cleartext-Password
  await db.execute(
    `INSERT INTO radcheck (username, attribute, op, value)
       VALUES (?, 'Cleartext-Password', ':=', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [normMac, RADIUS_PASS]
  );

  // 2. radreply — upsert Session-Timeout
  await db.execute(
    `INSERT INTO radreply (username, attribute, op, value)
       VALUES (?, 'Session-Timeout', ':=', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [normMac, String(timeout)]
  );

  // 3. Fire-and-forget login trigger — tells MikroTik to re-check RADIUS NOW
  //    MikroTik finds MAC in radcheck → Access-Accept → opens internet immediately
  const loginUrl =
    `http://${process.env.MIKROTIK_HOST || '192.168.88.1'}/login` +
    `?username=${encodeURIComponent(normMac)}` +
    `&password=${encodeURIComponent(RADIUS_PASS)}`;

  fetch(loginUrl).catch(err =>
    console.warn(`⚠ RADIUS login trigger failed (non-fatal): ${err.message}`)
  );

  console.log(`✅ RADIUS: granted ${normMac} | hours=${hours} | timeout=${timeout}s`);
  return { ok: true, mock: false, mac: normMac };
}

/**
 * revokeAccess(mac)
 * Removes the MAC from FreeRADIUS — MikroTik drops the session on next accounting.
 */
async function revokeAccess(mac) {
  const normMac = normalizeMac(mac);
  const db = pool();
  await db.execute('DELETE FROM radcheck WHERE username = ?', [normMac]);
  await db.execute('DELETE FROM radreply  WHERE username = ?', [normMac]);
  console.log(`🗑 RADIUS: revoked ${normMac}`);
  return { ok: true };
}

/**
 * testConnection()
 * Used by admin route /api/admin/radius/status
 */
async function testConnection() {
  try {
    const db = pool();
    const [[row]] = await db.execute('SELECT COUNT(*) AS n FROM radcheck');
    return { ok: true, authorizedMacs: row.n, host: process.env.RADIUS_DB_HOST || 'localhost' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * listAuthorizedClients()
 * Returns MACs currently in radcheck — used by admin stats.
 */
async function listAuthorizedClients() {
  try {
    const db = pool();
    const [rows] = await db.execute(
      `SELECT r.username AS mac, reply.value AS timeout_seconds
       FROM radcheck r
       LEFT JOIN radreply reply
         ON reply.username = r.username AND reply.attribute = 'Session-Timeout'
       WHERE r.attribute = 'Cleartext-Password'`
    );
    return rows;
  } catch {
    return [];
  }
}

/**
 * buildLogoutUrl(mac)
 * Returns the MikroTik logout URL for a MAC — used by admin session revoke.
 */
function buildLogoutUrl(mac) {
  const host = process.env.MIKROTIK_HOST || '192.168.88.1';
  const url  = mac
    ? `http://${host}/logout?username=${encodeURIComponent(normalizeMac(mac))}`
    : `http://${host}/logout`;
  return { url };
}

module.exports = { grantAccess, revokeAccess, testConnection, listAuthorizedClients, buildLogoutUrl, normalizeMac };
