'use strict';
/**
 * radius.js — RADIUS grant/revoke via MySQL + iptables (Pi-as-router edition)
 *
 * How it works:
 *   1. INSERT into radcheck  → records MAC authorisation in FreeRADIUS DB
 *   2. INSERT into radreply  → sets Session-Timeout for the MAC
 *   3. `iptables -I authorized_clients` → immediately opens firewall for this MAC
 *
 * NO MikroTik login URL call — Pi controls forwarding directly via iptables.
 * ipset is NOT used (ip_set_hash_mac kernel module missing on RPi custom kernel).
 * Instead, each MAC gets its own rule in the `authorized_clients` iptables chain.
 *
 * Prerequisites on the Pi:
 *   sudo iptables -N authorized_clients
 *   sudo iptables -A FORWARD -i eth1 -o eth0 -j authorized_clients
 *   sudo visudo → add:  admin ALL=(ALL) NOPASSWD: /sbin/iptables
 */

const mysql    = require('mysql2/promise');
const { exec } = require('child_process');
const util     = require('util');
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

// ── iptables helpers ──────────────────────────────────────────────────────

const LAN_IFACE = process.env.LAN_IFACE || 'eth1';

async function iptablesAdd(mac) {
  try {
    await execAsync(
      `sudo iptables -I authorized_clients 1 -m mac --mac-source ${mac} -j ACCEPT`
    );
  } catch (err) {
    console.warn(`⚠ iptables FORWARD add (non-fatal): ${err.message}`);
  }
  try {
    await execAsync(
      `sudo iptables -t nat -I PREROUTING 1 -i ${LAN_IFACE} -m mac --mac-source ${mac} -j RETURN`
    );
  } catch (err) {
    console.warn(`⚠ iptables NAT add (non-fatal): ${err.message}`);
  }
}

async function iptablesDel(mac) {
  try {
    await execAsync(
      `sudo iptables -D authorized_clients -m mac --mac-source ${mac} -j ACCEPT`
    );
  } catch (err) {
    console.warn(`⚠ iptables FORWARD del (non-fatal): ${err.message}`);
  }
  try {
    await execAsync(
      `sudo iptables -t nat -D PREROUTING -i ${LAN_IFACE} -m mac --mac-source ${mac} -j RETURN`
    );
  } catch (err) {
    console.warn(`⚠ iptables NAT del (non-fatal): ${err.message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

async function grantAccess(mac, hours = 1) {
  const normMac = normalizeMac(mac);
  const timeout = hours * 3600;
  const db = pool();

  await db.execute(
    `INSERT INTO radcheck (username, attribute, op, value)
       VALUES (?, 'Auth-Type', ':=', 'Accept')
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [normMac]
  );

  await db.execute(
    `INSERT INTO radreply (username, attribute, op, value)
       VALUES (?, 'Session-Timeout', ':=', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [normMac, String(timeout)]
  );

  await iptablesAdd(normMac);

  setTimeout(() => revokeAccess(normMac), timeout * 1000);

  console.log(`✅ Access granted: ${normMac} | hours=${hours}`);
  return { ok: true, mock: false, mac: normMac };
}

async function revokeAccess(mac) {
  const normMac = normalizeMac(mac);
  const db = pool();

  await db.execute('DELETE FROM radcheck WHERE username = ?', [normMac]);
  await db.execute('DELETE FROM radreply  WHERE username = ?', [normMac]);

  await iptablesDel(normMac);

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
    const db = pool();
    const [rows] = await db.execute(
      `SELECT r.username AS mac, reply.value AS timeout_seconds
       FROM radcheck r
       LEFT JOIN radreply reply
         ON reply.username = r.username AND reply.attribute = 'Session-Timeout'
       WHERE r.attribute = 'Auth-Type'`
    );
    return rows;
  } catch {
    return [];
  }
}

function buildLogoutUrl(mac) {
  return { url: null, note: 'Revoke via iptables — call revokeAccess(mac) directly' };
}

module.exports = {
  grantAccess,
  revokeAccess,
  testConnection,
  listAuthorizedClients,
  buildLogoutUrl,
  normalizeMac,
};
