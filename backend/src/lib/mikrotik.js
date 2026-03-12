'use strict';
/**
 * MikroTik Hotspot integration — RouterOS Binary API (port 8728)
 *
 * GRANT STRATEGY:
 *   Two-step process to fully authenticate a client:
 *
 *   Step 1: /ip/hotspot/user/add  — creates the user record
 *     This tells RouterOS "this MAC is allowed". With login-by=mac,
 *     RouterOS will auto-authenticate this MAC when it sees traffic.
 *
 *   Step 2: /ip/hotspot/active/login — creates the ACTIVE SESSION immediately
 *     This is the key step. Without it, the session only activates when
 *     RouterOS sees a packet from the MAC — but in practice that first
 *     packet (the browser navigating to /login) gets intercepted before
 *     the hotspot engine can match it as authenticated.
 *     Force-logging in via API bypasses this timing issue entirely.
 *     The client has internet instantly, no browser hit to /login needed.
 *
 * ENV VARS:
 *   MIKROTIK_HOST        192.168.88.1
 *   MIKROTIK_API_PORT    8728
 *   MIKROTIK_API_USER    pi-api
 *   MIKROTIK_API_PASS    (your password)
 *   MIKROTIK_HOTSPOT     hotspot1     (name of your /ip/hotspot entry)
 *   MIKROTIK_MOCK        false
 */

const net  = require('net');

const MOCK     = process.env.MIKROTIK_MOCK     === 'true';
const HS_HOST  = process.env.MIKROTIK_HOST     || '192.168.88.1';
const API_PORT = parseInt(process.env.MIKROTIK_API_PORT || '8728', 10);
const API_USER = process.env.MIKROTIK_API_USER || 'pi-api';
const API_PASS = process.env.MIKROTIK_API_PASS || '';
const HS_NAME  = process.env.MIKROTIK_HOTSPOT  || 'hotspot1';

// ── RouterOS Binary API ─────────────────────────────────────────────────────

function encodeLength(len) {
  if (len < 0x80)       return Buffer.from([len]);
  if (len < 0x4000)     return Buffer.from([(len >> 8) | 0x80, len & 0xFF]);
  if (len < 0x200000)   return Buffer.from([(len >> 16) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
  if (len < 0x10000000) return Buffer.from([(len >> 24) | 0xE0, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
  throw new Error(`Word too long: ${len}`);
}

function encodeWord(word) {
  const b = Buffer.from(word, 'utf8');
  return Buffer.concat([encodeLength(b.length), b]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0x00])]);
}

function decodeSentences(buf) {
  const sentences = [];
  let cur = [], i = 0;
  while (i < buf.length) {
    let len, skip;
    const b0 = buf[i];
    if      ((b0 & 0xE0) === 0xE0) { len = ((b0 & 0x1F) << 24) | (buf[i+1] << 16) | (buf[i+2] << 8) | buf[i+3]; skip = 4; }
    else if ((b0 & 0xC0) === 0xC0) { len = ((b0 & 0x3F) << 16) | (buf[i+1] << 8)  | buf[i+2];                    skip = 3; }
    else if ((b0 & 0x80) === 0x80) { len = ((b0 & 0x7F) << 8)  | buf[i+1];                                        skip = 2; }
    else                            { len = b0;                                                                      skip = 1; }
    i += skip;
    if (len === 0) { if (cur.length) { sentences.push(cur); cur = []; } }
    else           { cur.push(buf.slice(i, i + len).toString('utf8')); i += len; }
  }
  return sentences;
}

function parseSentence(words) {
  const type  = words[0] || '';
  const attrs = {};
  for (const w of words.slice(1)) {
    const eq = w.indexOf('=');
    if (eq > 0) attrs[w.slice(1, eq)] = w.slice(eq + 1);
  }
  return { type, attrs };
}

function runCommands(commands) {
  return new Promise((resolve, reject) => {
    const socket  = new net.Socket();
    const results = [];
    let   buf     = Buffer.alloc(0);
    let   cmdIdx  = 0;
    let   loggedIn = false;

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('RouterOS API timeout (10s)'));
    }, 10000);

    socket.connect(API_PORT, HS_HOST, () => {
      socket.write(encodeSentence([
        '/login', `=name=${API_USER}`, `=password=${API_PASS}`,
      ]));
    });

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const sentences = decodeSentences(buf);
      // Consume only complete sentences — keep remainder in buf
      let consumed = 0;
      for (const words of sentences) {
        const p = parseSentence(words);
        if (!loggedIn) {
          if (p.type === '!done') {
            loggedIn = true;
            sendNext();
          } else if (p.type === '!trap') {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error(`Login failed: ${p.attrs.message || JSON.stringify(p.attrs)}`));
          }
        } else {
          if (!results[cmdIdx]) results[cmdIdx] = [];
          results[cmdIdx].push(p);
          if (p.type === '!done' || p.type === '!trap') {
            cmdIdx++;
            if (cmdIdx < commands.length) sendNext();
            else { clearTimeout(timeout); socket.end(); resolve(results); }
          }
        }
      }
      // Recalculate buf as whatever wasn't consumed — simplest: re-encode sentences
      // Actually decodeSentences reads all available — so buf is fully consumed each call
      buf = Buffer.alloc(0);
    });

    socket.on('error', err => { clearTimeout(timeout); reject(err); });
    socket.on('close', () => {
      clearTimeout(timeout);
      if (cmdIdx >= commands.length) resolve(results);
      else reject(new Error('Connection closed before all commands completed'));
    });

    function sendNext() {
      socket.write(encodeSentence(commands[cmdIdx]));
    }
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Grant internet access to a MAC address.
 *
 * Two-step:
 *   1. Add/update /ip/hotspot/user entry (for login-by=mac auto-auth)
 *   2. Force-create active session via /ip/hotspot/active/login
 *      This immediately grants internet — no browser redirect needed.
 */
async function grantAccess(mac, sessionHours) {
  if (MOCK) {
    console.log(`[MOCK] grantAccess: mac=${mac} hours=${sessionHours}`);
    return { ok: true, mock: true };
  }
  if (!mac) return { ok: false, mock: false, error: 'No MAC address' };

  const normMac = mac.toUpperCase();
  const h       = String(Math.floor(sessionHours)).padStart(2, '0');
  const m       = String(Math.round((sessionHours % 1) * 60)).padStart(2, '0');
  const uptime  = `${h}:${m}:00`;

  try {
    // ── Step 1: User record (login-by=mac needs this) ──────────────────────
    const findResults = await runCommands([
      ['/ip/hotspot/user/print', `?mac-address=${normMac}`],
    ]);
    for (const reply of (findResults[0] || [])) {
      if (reply.type === '!re' && reply.attrs['.id']) {
        await runCommands([['/ip/hotspot/user/remove', `=.id=${reply.attrs['.id']}`]]);
        console.log(`[MikroTik] Removed existing user ${normMac}`);
      }
    }
    await runCommands([[
      '/ip/hotspot/user/add',
      `=name=${normMac}`,
      `=mac-address=${normMac}`,
      `=profile=default`,
      `=limit-uptime=${uptime}`,
      `=comment=CityNet ${new Date().toISOString().slice(0,10)}`,
    ]]);
    console.log(`[MikroTik] User added: ${normMac} limit-uptime=${uptime}`);

    // ── Step 2: Force-create active session ───────────────────────────────
    // /ip/hotspot/active/login creates an authenticated session immediately.
    // This is equivalent to the user clicking "login" on the hotspot page,
    // but done server-side. No browser hit to 192.168.88.1/login needed.
    //
    // Required params:
    //   ip       — client IP address (from DHCP lease)
    //   mac      — client MAC
    //   user     — must match the hotspot user name (we use MAC as name)
    //   password — must match hotspot user password (empty for MAC auth users)
    //   server   — the hotspot server name (/ip/hotspot name=)
    //
    // We need the client's current IP. Get it from the DHCP lease table.
    const leaseResults = await runCommands([
      ['/ip/dhcp-server/lease/print', `?mac-address=${normMac}`],
    ]);
    let clientIp = null;
    for (const reply of (leaseResults[0] || [])) {
      if (reply.type === '!re' && reply.attrs.address) {
        clientIp = reply.attrs.address;
        break;
      }
    }

    if (!clientIp) {
      // No DHCP lease found — this can happen if the client used a static IP
      // or the lease expired. Fall back to user-only auth and let RouterOS
      // auto-activate when the client sends its next packet.
      console.warn(`[MikroTik] No DHCP lease found for ${normMac} — user added, session will auto-activate`);
      return { ok: true, mock: false, activeSession: false };
    }

    console.log(`[MikroTik] Client IP from DHCP: ${clientIp}`);

    // Force login
    const loginResult = await runCommands([[
      '/ip/hotspot/active/login',
      `=ip=${clientIp}`,
      `=mac-address=${normMac}`,
      `=user=${normMac}`,
      `=password=`,
      `=server=${HS_NAME}`,
    ]]);

    const loginReply = (loginResult[0] || []).find(r => r.type === '!done' || r.type === '!trap');
    if (loginReply?.type === '!trap') {
      // Active login failed — not fatal, user record exists so auto-auth will kick in
      console.warn(`[MikroTik] active/login trap: ${loginReply.attrs.message} — falling back to auto-auth`);
      return { ok: true, mock: false, activeSession: false, warning: loginReply.attrs.message };
    }

    console.log(`✅ [MikroTik] Active session created for ${normMac} @ ${clientIp}`);
    return { ok: true, mock: false, activeSession: true, clientIp };

  } catch (err) {
    console.error(`❌ [MikroTik] grantAccess failed for ${normMac}:`, err.message);
    return { ok: false, mock: false, error: err.message };
  }
}

/**
 * Revoke access — remove user record and kick active session.
 */
async function revokeAccess(mac) {
  if (MOCK) return { ok: true, mock: true };
  const normMac = mac.toUpperCase();
  try {
    // Remove user
    const find = await runCommands([['/ip/hotspot/user/print', `?mac-address=${normMac}`]]);
    for (const r of (find[0] || [])) {
      if (r.type === '!re' && r.attrs['.id'])
        await runCommands([['/ip/hotspot/user/remove', `=.id=${r.attrs['.id']}`]]);
    }
    // Kick active session
    const active = await runCommands([['/ip/hotspot/active/print', `?mac-address=${normMac}`]]);
    for (const r of (active[0] || [])) {
      if (r.type === '!re' && r.attrs['.id'])
        await runCommands([['/ip/hotspot/active/remove', `=.id=${r.attrs['.id']}`]]);
    }
    console.log(`[MikroTik] Revoked: ${normMac}`);
    return { ok: true, mock: false };
  } catch (err) {
    return { ok: false, mock: false, error: err.message };
  }
}

async function listAuthorizedClients() {
  if (MOCK) return [{ address: '192.168.88.10', 'mac-address': '02:00:C0:A8:58:0A', uptime: '01:23:00' }];
  try {
    const results = await runCommands([['/ip/hotspot/active/print']]);
    return (results[0] || []).filter(r => r.type === '!re').map(r => r.attrs);
  } catch { return []; }
}

async function testConnection() {
  if (MOCK) return { ok: true, mode: 'mock', identity: 'MOCK' };
  try {
    const results = await runCommands([['/system/identity/print']]);
    const identity = (results[0] || []).find(r => r.type === '!re')?.attrs?.name || HS_HOST;
    return { ok: true, mode: 'api', identity, host: HS_HOST, port: API_PORT, user: API_USER };
  } catch (err) {
    return { ok: false, mode: 'api', host: HS_HOST, port: API_PORT, error: err.message };
  }
}

module.exports = { grantAccess, revokeAccess, listAuthorizedClients, testConnection };
