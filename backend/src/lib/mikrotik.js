'use strict';
/**
 * MikroTik Hotspot — RouterOS Binary API (port 8728)
 *
 * TWO-PATH GRANT STRATEGY:
 *
 * Path A — /ip/hotspot/active/login (v6.34+, CLI command via API)
 *   Correct params: user= password= mac-address= ip=
 *   NO server= param (that's what was causing the empty trap)
 *   This directly creates an active session server-side.
 *
 * Path B — /ip/hotspot/user/add with password=MAC set
 *   With mac-auth-mode=mac-as-username-and-password, BOTH name=MAC AND password=MAC
 *   must be set. Without password= the auto-auth silently fails.
 *   After user/add, ConnectingPage navigates to http://192.168.88.1/login
 *   which triggers the hotspot engine to authenticate via the user table.
 */

const net = require('net');

const MOCK     = process.env.MIKROTIK_MOCK     === 'true';
const HS_HOST  = process.env.MIKROTIK_HOST     || '192.168.88.1';
const API_PORT = parseInt(process.env.MIKROTIK_API_PORT || '8728', 10);
const API_USER = process.env.MIKROTIK_API_USER || 'pi-api';
const API_PASS = process.env.MIKROTIK_API_PASS || '';
const HS_NAME  = process.env.MIKROTIK_HOTSPOT  || 'hotspot1';

// ── Encoding ──────────────────────────────────────────────────────────────────
function encodeLength(len) {
  if (len < 0x80)       return Buffer.from([len]);
  if (len < 0x4000)     return Buffer.from([(len >> 8) | 0x80, len & 0xFF]);
  if (len < 0x200000)   return Buffer.from([(len >> 16) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
  if (len < 0x10000000) return Buffer.from([(len >> 24) | 0xE0, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
  throw new Error('Word too long');
}
function encodeWord(w)      { const b = Buffer.from(w,'utf8'); return Buffer.concat([encodeLength(b.length), b]); }
function encodeSentence(ws) { return Buffer.concat([...ws.map(encodeWord), Buffer.from([0x00])]); }

// ── Decoding — buffers partial TCP data, never loses bytes ────────────────────
function decodeSentences(buf) {
  const sentences = []; let words = []; let i = 0;
  while (i < buf.length) {
    const b0 = buf[i]; let lenBytes, len;
    if      ((b0 & 0xE0) === 0xE0) { lenBytes = 4; }
    else if ((b0 & 0xC0) === 0xC0) { lenBytes = 3; }
    else if ((b0 & 0x80) === 0x80) { lenBytes = 2; }
    else                            { lenBytes = 1; }
    if (i + lenBytes > buf.length) break;  // wait for more data
    if      (lenBytes === 4) len = ((b0 & 0x1F) << 24) | (buf[i+1] << 16) | (buf[i+2] << 8) | buf[i+3];
    else if (lenBytes === 3) len = ((b0 & 0x3F) << 16) | (buf[i+1] << 8)  | buf[i+2];
    else if (lenBytes === 2) len = ((b0 & 0x7F) << 8)  | buf[i+1];
    else                     len = b0;
    i += lenBytes;
    if (len === 0) { if (words.length) { sentences.push(words); words = []; } continue; }
    if (i + len > buf.length) { i -= lenBytes; break; }  // word incomplete, rewind
    words.push(buf.slice(i, i + len).toString('utf8'));
    i += len;
  }
  return { sentences, consumed: i };
}

function parseSentence(words) {
  const type = words[0] || '', attrs = {};
  for (const w of words.slice(1)) { const eq = w.indexOf('='); if (eq > 0) attrs[w.slice(1, eq)] = w.slice(eq + 1); }
  return { type, attrs };
}

// ── TCP runner — accumulates partial packets correctly ─────────────────────────
function runCommands(commands, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const results = []; let partial = Buffer.alloc(0), cmdIdx = 0, loggedIn = false;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`API timeout ${timeoutMs}ms`)); }, timeoutMs);

    socket.connect(API_PORT, HS_HOST, () => {
      socket.write(encodeSentence(['/login', `=name=${API_USER}`, `=password=${API_PASS}`]));
    });

    socket.on('data', chunk => {
      partial = Buffer.concat([partial, chunk]);
      while (true) {
        const { sentences, consumed } = decodeSentences(partial);
        if (consumed === 0) break;
        partial = partial.slice(consumed);
        for (const words of sentences) {
          const p = parseSentence(words);
          if (!loggedIn) {
            if (p.type === '!done') { loggedIn = true; socket.write(encodeSentence(commands[0])); }
            else if (p.type === '!trap') { clearTimeout(timer); socket.destroy(); reject(new Error(`Login: ${p.attrs.message || JSON.stringify(p.attrs)}`)); }
          } else {
            if (!results[cmdIdx]) results[cmdIdx] = [];
            results[cmdIdx].push(p);
            if (p.type === '!done' || p.type === '!trap') {
              cmdIdx++;
              if (cmdIdx < commands.length) socket.write(encodeSentence(commands[cmdIdx]));
              else { clearTimeout(timer); socket.end(); resolve(results); }
            }
          }
        }
      }
    });
    socket.on('error', err => { clearTimeout(timer); reject(err); });
    socket.on('close', () => { clearTimeout(timer); resolve(results); });
  });
}

function getReplies(results, idx) {
  return (results[idx] || []).filter(r => r.type === '!re').map(r => r.attrs);
}
function getTrap(results, idx) {
  return (results[idx] || []).find(r => r.type === '!trap')?.attrs ?? null;
}

// ── Grant ─────────────────────────────────────────────────────────────────────
async function grantAccess(mac, sessionHours, knownIp = null) {
  if (MOCK) {
    console.log(`[MOCK] grantAccess mac=${mac} hours=${sessionHours}`);
    return { ok: true, mock: true, activeSession: false };
  }
  if (!mac) return { ok: false, mock: false, error: 'No MAC address' };

  const normMac = mac.toUpperCase();
  const h = String(Math.floor(sessionHours)).padStart(2, '0');
  const m = String(Math.round((sessionHours % 1) * 60)).padStart(2, '0');
  const uptime = `${h}:${m}:00`;

  try {
    // ── 1. Remove stale user entry ────────────────────────────────────────
    const existing = await runCommands([['/ip/hotspot/user/print', `?mac-address=${normMac}`]]);
    for (const u of getReplies(existing, 0)) {
      if (u['.id']) {
        await runCommands([['/ip/hotspot/user/remove', `=.id=${u['.id']}`]]);
        console.log(`[MikroTik] Removed stale entry for ${normMac}`);
      }
    }

    // ── 2. Add user with BOTH name=MAC and password=MAC ───────────────────
    // CRITICAL: mac-auth-mode=mac-as-username-and-password requires password=MAC.
    // Without it, login-by=mac silently fails even if the MAC is in the user table.
    await runCommands([[
      '/ip/hotspot/user/add',
      `=name=${normMac}`,
      `=mac-address=${normMac}`,
      `=password=${normMac}`,        // ← THE FIX: was missing in all previous versions
      `=profile=default`,
      `=limit-uptime=${uptime}`,
      `=comment=CityNet ${new Date().toISOString().slice(0, 10)}`,
    ]]);
    console.log(`✅ [MikroTik] User added: ${normMac} uptime=${uptime} password=MAC`);

    // ── 3. Try /ip/hotspot/active/login (correct params, no server=) ──────
    // From MikroTik wiki: /ip hotspot active login user= password= mac-address= ip=
    // Available since v6.34. The trap we got before was because we sent server=
    // which is NOT a valid parameter for this command.
    const clientIp = knownIp || null;
    if (clientIp) {
      const loginRes = await runCommands([[
        '/ip/hotspot/active/login',
        `=ip=${clientIp}`,
        `=mac-address=${normMac}`,
        `=user=${normMac}`,
        `=password=${normMac}`,
        // NO =server= param — that was the bug
      ]]);

      const trap = getTrap(loginRes, 0);
      if (!trap) {
        await new Promise(r => setTimeout(r, 500));
        const verify = await runCommands([['/ip/hotspot/active/print', `?mac-address=${normMac}`]]);
        const active = getReplies(verify, 0).length > 0;
        console.log(`✅ [MikroTik] active/login OK: ${normMac} @ ${clientIp} | verified=${active}`);
        return { ok: true, mock: false, activeSession: active, clientIp };
      }

      console.warn(`[MikroTik] active/login trap: ${JSON.stringify(trap)}`);
      console.log(`   → Falling back to browser-triggered auto-auth`);
      console.log(`   → User entry has password=MAC set — ConnectingPage /login URL will work`);
    }

    // active/login unavailable or no IP — ConnectingPage handles activation
    return { ok: true, mock: false, activeSession: false, clientIp };

  } catch (err) {
    console.error(`❌ [MikroTik] grantAccess failed:`, err.message);
    return { ok: false, mock: false, error: err.message };
  }
}

// ── Revoke ────────────────────────────────────────────────────────────────────
async function revokeAccess(mac) {
  if (MOCK) return { ok: true, mock: true };
  const normMac = mac.toUpperCase();
  try {
    const users = await runCommands([['/ip/hotspot/user/print', `?mac-address=${normMac}`]]);
    for (const u of getReplies(users, 0)) {
      if (u['.id']) await runCommands([['/ip/hotspot/user/remove', `=.id=${u['.id']}`]]);
    }
    const sessions = await runCommands([['/ip/hotspot/active/print', `?mac-address=${normMac}`]]);
    for (const s of getReplies(sessions, 0)) {
      if (s['.id']) await runCommands([['/ip/hotspot/active/remove', `=.id=${s['.id']}`]]);
    }
    return { ok: true, mock: false };
  } catch (err) {
    return { ok: false, mock: false, error: err.message };
  }
}

async function listAuthorizedClients() {
  if (MOCK) return [];
  try {
    const r = await runCommands([['/ip/hotspot/active/print']]);
    return getReplies(r, 0);
  } catch { return []; }
}

async function testConnection() {
  if (MOCK) return { ok: true, mode: 'mock', identity: 'MOCK' };
  try {
    const r = await runCommands([['/system/identity/print']]);
    const identity = getReplies(r, 0)[0]?.name || HS_HOST;
    return { ok: true, mode: 'api', identity, host: HS_HOST, port: API_PORT };
  } catch (err) {
    return { ok: false, mode: 'api', host: HS_HOST, port: API_PORT, error: err.message };
  }
}

module.exports = { grantAccess, revokeAccess, listAuthorizedClients, testConnection };
