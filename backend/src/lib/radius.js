'use strict';
const mysql     = require('mysql2/promise');
const http      = require('http');
const crypto    = require('crypto');
const { exec }  = require('child_process');
const util      = require('util');
const execAsync = util.promisify(exec);

// ── Config ────────────────────────────────────────────────────────────────
const CHILLI_CMD  = process.env.CHILLI_QUERY_CMD || 'sudo chilli_query -s /var/run/chilli.ipc';
const UAM_SECRET  = process.env.UAM_SECRET  || 'm0t0m0t0';
const UAM_HOST    = process.env.UAM_HOST    || '192.168.182.1';
const UAM_PORT    = parseInt(process.env.UAM_PORT || '3990');

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

// ── UAM logon — this is what actually opens internet on CoovaChilli ───────
// CoovaChilli UAM response formula:
//   password = MD5(uamsecret + username)       — hex string
//   response = MD5(challenge_hex + username)   — hex string
// Then GET http://uamlisten:uamport/logon?username=MAC&response=RESPONSE
// Chilli returns 302 on success (session moves from dnat → pass).
async function chilliUamLogon(mac, challenge) {
  if (!challenge) {
    console.warn(`[UAM] No challenge for ${mac} — skipping UAM logon`);
    return false;
  }
  try {
    const username = mac; // MAC is the username in CoovaChilli UAM auth
    const pwHash   = crypto.createHash('md5')
                           .update(UAM_SECRET + username)
                           .digest('hex');
    const response = crypto.createHash('md5')
                           .update(challenge + pwHash)
                           .digest('hex');

    const path = `/logon?username=${encodeURIComponent(username)}&response=${response}` +
                 `&userurl=${encodeURIComponent('http://192.168.182.1:3990/loggedin')}`;

    console.log(`[UAM] Calling logon for ${mac} (challenge=${challenge.slice(0,8)}...)`);

    return await new Promise((resolve) => {
      const req = http.request(
        { host: UAM_HOST, port: UAM_PORT, path, method: 'GET' },
        (res) => {
          // Consume response body to free socket
          res.resume();
          const ok = res.statusCode === 302 || res.statusCode === 200;
          console.log(`[UAM] logon ${mac}: HTTP ${res.statusCode} → ${ok ? 'authorized' : 'FAILED'}`);
          if (!ok) {
            console.warn(`[UAM] Location: ${res.headers.location || 'none'}`);
          }
          resolve(ok);
        }
      );
      req.on('error', (err) => {
        console.warn(`[UAM] logon request failed for ${mac}: ${err.message}`);
        resolve(false);
      });
      req.setTimeout(5000, () => {
        console.warn(`[UAM] logon timeout for ${mac}`);
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  } catch (err) {
    console.warn(`[UAM] logon error for ${mac}: ${err.message}`);
    return false;
  }
}

// ── chilli_query authorize — updates session timeout if already authed ────
async function chilliAuthorize(mac, timeoutSeconds = 3600, clientIp = null) {
  try {
    let ip = clientIp;

    // If no IP, try to look it up from chilli's session list
    if (!ip) {
      try {
        const { stdout } = await execAsync(`${CHILLI_CMD} list`);
        if (stdout && stdout.trim()) {
          const dashMac = mac.replace(/:/g, '-').toUpperCase();
          const line = stdout.split('\n').find(l =>
            l.toUpperCase().includes(dashMac) || l.toUpperCase().includes(mac.toUpperCase())
          );
          if (line) {
            ip = line.trim().split(/\s+/)[1];
            console.log(`[CHILLI] Resolved IP for ${mac} from list: ${ip}`);
          }
        }
      } catch {}
    }

    if (!ip) {
      console.warn(`[CHILLI] No IP for ${mac} — skipping chilli_query authorize`);
      return;
    }

    const cmd = `${CHILLI_CMD} authorize ip ${ip} sessiontimeout ${timeoutSeconds} username ${mac}`;
    const { stdout, stderr } = await execAsync(cmd);
    console.log(`[CHILLI] authorize ${mac} (ip=${ip}): ${(stdout || stderr || 'ok').trim()}`);
  } catch (err) {
    console.warn(`[CHILLI] authorize failed for ${mac}: ${err.message}`);
  }
}

async function chilliDeauthorize(mac) {
  try {
    // logout takes positional MAC — no 'mac' keyword
    const cmd = `${CHILLI_CMD} logout ${mac}`;
    const { stdout, stderr } = await execAsync(cmd);
    console.log(`[CHILLI] logout ${mac}: ${(stdout || stderr || 'ok').trim()}`);
  } catch (err) {
    console.warn(`[CHILLI] logout failed for ${mac}: ${err.message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────
async function grantAccess(mac, hours = 1, clientIp = null, challenge = null) {
  const normMac = normalizeMac(mac);
  const dashMac = normMac.replace(/:/g, '-');
  const timeout = hours * 3600;
  const db = pool();

  // Write RADIUS DB entries with deadlock retry
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        for (const username of [normMac, dashMac]) {
          await conn.execute(
            `INSERT INTO radcheck (username, attribute, op, value)
               VALUES (?, 'Auth-Type', ':=', 'Accept')
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
            [username]
          );
          await conn.execute(
            `INSERT INTO radreply (username, attribute, op, value)
               VALUES (?, 'Session-Timeout', ':=', ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
            [username, String(timeout)]
          );
        }
        await conn.commit();
        break; // success — exit retry loop
      } catch (err) {
        await conn.rollback();
        if (err.errno === 1213 && attempt < 2) {
          // Deadlock — wait briefly and retry
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        throw err;
      } finally {
        conn.release();
      }
    } catch (err) {
      if (attempt === 2) console.warn(`[RADIUS] DB write failed after 3 attempts: ${err.message}`);
    }
  }

  // Step 1: UAM logon
  const uamOk = await chilliUamLogon(normMac, challenge);

  // Step 2: chilli_query authorize
  await chilliAuthorize(normMac, timeout, clientIp);

  console.log(`✅ Access granted: ${normMac} | hours=${hours} | uam=${uamOk}`);
  return { ok: true, mock: false, mac: normMac };
}
async function revokeAccess(mac) {
  const normMac = normalizeMac(mac);
  const dashMac = normMac.replace(/:/g, '-');
  const db = pool();

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
      return { mac: parts[0], ip: parts[1], state: parts[2], authenticated: parts[4] === '1' };
    });
  } catch {
    return [];
  }
}

function buildLogoutUrl(_mac) {
  return { url: null, note: 'Revoke via chilli_query — call revokeAccess(mac) directly' };
}

module.exports = {
  grantAccess, revokeAccess, testConnection,
  listAuthorizedClients, buildLogoutUrl, normalizeMac,
};