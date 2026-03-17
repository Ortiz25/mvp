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

const http = require('http');
const crypto = require('crypto');

const UAM_SECRET = process.env.UAM_SECRET || 'm0t0m0t0';
const UAM_URL    = process.env.UAM_URL    || 'http://192.168.182.1:3990';



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

// Replace chilliAuthorize with this:
async function chilliAuthorize(mac, timeoutSeconds = 3600, clientIp = null) {
  try {
    let ip = clientIp;

    // If no IP provided, look it up from chilli's session table
    if (!ip) {
      try {
        const { stdout } = await execAsync(`${CHILLI_CMD} list`);
        if (stdout && stdout.trim()) {
          // list format: MAC IP state sessionid auth username ...
          const dashMac = mac.replace(/:/g, '-').toUpperCase();
          const line = stdout.split('\n').find(l =>
            l.toUpperCase().includes(dashMac) || l.toUpperCase().includes(mac.toUpperCase())
          );
          if (line) {
            const parts = line.trim().split(/\s+/);
            ip = parts[1]; // second column is IP
            console.log(`[CHILLI] Resolved IP for ${mac} from list: ${ip}`);
          }
        }
      } catch (e) {
        console.warn(`[CHILLI] list lookup failed: ${e.message}`);
      }
    }

    if (!ip) {
      console.warn(`[CHILLI] No IP found for ${mac} — authorize skipped. Client must reconnect.`);
      return;
    }

    const cmd = `${CHILLI_CMD} authorize ip ${ip} sessiontimeout ${timeoutSeconds} username ${mac}`;
    const { stdout, stderr } = await execAsync(cmd);
    const out = (stdout || stderr || '').trim();
    console.log(`[CHILLI] authorize ${mac} (ip=${ip}): ${out || 'ok'}`);
  } catch (err) {
    console.warn(`[CHILLI] authorize failed for ${mac}: ${err.message}`);
  }
}
  async function chilliDeauthorize(mac) {
    try {
      // Use 'logout' command with mac keyword — 'deauthorize' may not exist in 1.8
      const cmd = `${CHILLI_CMD} logout ${mac}`;
      const { stdout, stderr } = await execAsync(cmd);
      console.log(`[CHILLI] logout ${mac}: ${(stdout || stderr || 'ok').trim()}`);
    } catch (err) {
      console.warn(`[CHILLI] logout failed for ${mac}: ${err.message}`);
    }
  }

  async function chilliUamLogin(mac, challenge) {
    if (!challenge) {
      console.warn('[UAM] No challenge — cannot do UAM login for', mac);
      return false;
    }
    try {
      // CoovaChilli UAM response calculation:
      // 1. password = MD5(uamsecret + username)  — where username = MAC
      // 2. response = MD5(challenge_hex + password_hex)
      const username = mac; // MAC address is the username
      const pwHash   = crypto.createHash('md5')
                             .update(UAM_SECRET + username)
                             .digest('hex');
      const response = crypto.createHash('md5')
                             .update(challenge + pwHash)
                             .digest('hex');
  
      const url = `${UAM_URL}/logon?username=${encodeURIComponent(username)}&response=${response}&userurl=${encodeURIComponent('http://192.168.182.1:3990/loggedin')}`;
      console.log(`[UAM] Calling logon for ${mac}`);
  
      return await new Promise((resolve) => {
        http.get(url, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log(`[UAM] logon response for ${mac}: HTTP ${res.statusCode}`);
            // CoovaChilli returns 302 to userurl on success
            resolve(res.statusCode === 302 || res.statusCode === 200);
          });
        }).on('error', (err) => {
          console.warn(`[UAM] logon failed for ${mac}: ${err.message}`);
          resolve(false);
        });
      });
    } catch (err) {
      console.warn(`[UAM] logon error for ${mac}: ${err.message}`);
      return false;
    }
  }
// ── Public API ────────────────────────────────────────────────────────────

async function grantAccess(mac, hours = 1, clientIp = null, challenge = null) {
  const normMac = normalizeMac(mac);
  const dashMac = normMac.replace(/:/g, '-');
  const timeout = hours * 3600;
  const db = pool();

  // Write to RADIUS DB (for session persistence across restarts)
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

  // Primary: UAM logon (actually authorizes the live chilli session)
  const uamOk = await chilliUamLogin(normMac, challenge);
  
  // Fallback: chilli_query authorize (updates timeout if session already authed)
  await chilliAuthorize(normMac, timeout, clientIp);

  console.log(`✅ Access granted: ${normMac} | hours=${hours} | uam=${uamOk}`);
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