'use strict';
/**
 * MikroTik Hotspot — RouterOS Binary API (port 8728)
 * 
 * GRANT MECHANISM:
 * 1. Pi adds MAC to /ip/hotspot/user via binary API
 * 2. Try /ip/hotspot/active/add to force-create session (RouterOS 7 supports this
 *    with correct params: =address= =mac-address= =user=)
 * 3. If active/add fails, ConnectingPage navigates browser to
 *    http://192.168.88.1/login?username=MAC&password=MAC
 *    RouterOS hotspot engine intercepts, finds MAC in user table, auto-auths.
 *
 * API PROTOCOL NOTE (from MikroTik docs):
 * - Post-v6.43 login: send /login =name= =password= in ONE sentence
 * - Sentences are zero-terminated sequences of length-prefixed words
 * - Partial TCP packets must be buffered — only consume complete sentences
 */

const net = require('net');

const MOCK     = process.env.MIKROTIK_MOCK     === 'true';
const HS_HOST  = process.env.MIKROTIK_HOST     || '192.168.88.1';
const API_PORT = parseInt(process.env.MIKROTIK_API_PORT || '8728', 10);
const API_USER = process.env.MIKROTIK_API_USER || 'pi-api';
const API_PASS = process.env.MIKROTIK_API_PASS || '';
const HS_NAME  = process.env.MIKROTIK_HOTSPOT  || 'hotspot1';

// ── Encoding ─────────────────────────────────────────────────────────────────

function encodeLength(len) {
  if (len < 0x80)       return Buffer.from([len]);
  if (len < 0x4000)     return Buffer.from([(len >> 8) | 0x80, len & 0xFF]);
  if (len < 0x200000)   return Buffer.from([(len >> 16) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
  if (len < 0x10000000) return Buffer.from([(len >> 24) | 0xE0, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
  throw new Error('Word too long');
}
function encodeWord(w)     { const b = Buffer.from(w, 'utf8'); return Buffer.concat([encodeLength(b.length), b]); }
function encodeSentence(ws){ return Buffer.concat([...ws.map(encodeWord), Buffer.from([0x00])]); }

// ── Decoding — FIXED: tracks byte position, never discards partial sentences ─

/**
 * Decode as many complete sentences as possible from buf.
 * Returns { sentences, consumed } where consumed = bytes fully parsed.
 * Caller should keep buf.slice(consumed) for the next data event.
 */
function decodeSentences(buf) {
  const sentences = [];
  let current = [];
  let i = 0;

  while (i < buf.length) {
    // Peek at length bytes needed
    const b0 = buf[i];
    let lenBytes, len;
    if      ((b0 & 0xE0) === 0xE0) { lenBytes = 4; }
    else if ((b0 & 0xC0) === 0xC0) { lenBytes = 3; }
    else if ((b0 & 0x80) === 0x80) { lenBytes = 2; }
    else                            { lenBytes = 1; }

    // Wait for enough bytes to read the length prefix
    if (i + lenBytes > buf.length) break;

    if      (lenBytes === 4) len = ((b0 & 0x1F) << 24) | (buf[i+1] << 16) | (buf[i+2] << 8) | buf[i+3];
    else if (lenBytes === 3) len = ((b0 & 0x3F) << 16) | (buf[i+1] << 8) | buf[i+2];
    else if (lenBytes === 2) len = ((b0 & 0x7F) << 8) | buf[i+1];
    else                     len = b0;

    i += lenBytes;

    if (len === 0) {
      // End of sentence
      if (current.length) { sentences.push(current); current = []; }
      continue;
    }

    // Wait for the full word content
    if (i + len > buf.length) {
      // Rewind — we can't complete this word
      i -= lenBytes;
      break;
    }

    current.push(buf.slice(i, i + len).toString('utf8'));
    i += len;
  }

  return { sentences, consumed: i };
}

function parseSentence(words) {
  const type = words[0] || '';
  const attrs = {};
  for (const w of words.slice(1)) {
    const eq = w.indexOf('=');
    if (eq > 0) attrs[w.slice(1, eq)] = w.slice(eq + 1);
  }
  return { type, attrs };
}

// ── TCP connection + command runner ──────────────────────────────────────────

function runCommands(commands, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket  = new net.Socket();
    const results = [];
    let   partial = Buffer.alloc(0);   // ← accumulates partial TCP data
    let   cmdIdx  = 0;
    let   loggedIn= false;

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`MikroTik API timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.connect(API_PORT, HS_HOST, () => {
      // Post-v6.43 login: name + password in same sentence
      socket.write(encodeSentence(['/login', `=name=${API_USER}`, `=password=${API_PASS}`]));
    });

    socket.on('data', chunk => {
      partial = Buffer.concat([partial, chunk]);

      // Keep decoding until no more complete sentences
      while (true) {
        const { sentences, consumed } = decodeSentences(partial);
        if (consumed === 0) break;
        partial = partial.slice(consumed);  // keep only unprocessed bytes

        for (const words of sentences) {
          const p = parseSentence(words);

          if (!loggedIn) {
            if (p.type === '!done') {
              loggedIn = true;
              socket.write(encodeSentence(commands[0]));
            } else if (p.type === '!trap') {
              clearTimeout(timer);
              socket.destroy();
              reject(new Error(`Login failed: ${p.attrs.message || JSON.stringify(p.attrs)}`));
            }
          } else {
            if (!results[cmdIdx]) results[cmdIdx] = [];
            results[cmdIdx].push(p);

            if (p.type === '!done' || p.type === '!trap') {
              cmdIdx++;
              if (cmdIdx < commands.length) {
                socket.write(encodeSentence(commands[cmdIdx]));
              } else {
                clearTimeout(timer);
                socket.end();
                resolve(results);
              }
            }
          }
        }
      }
    });

    socket.on('error', err => { clearTimeout(timer); reject(err); });
    socket.on('close', () => {
      clearTimeout(timer);
      if (cmdIdx >= commands.length) resolve(results);
      // If connection closed before all commands finished, still resolve with what we have
      else resolve(results);
    });
  });
}

function getReplies(results, idx) {
  return (results[idx] || []).filter(r => r.type === '!re').map(r => r.attrs);
}
function getTrap(results, idx) {
  return (results[idx] || []).find(r => r.type === '!trap')?.attrs || null;
}

// ── Grant access ─────────────────────────────────────────────────────────────

/**
 * Grant internet access to a device.
 * 
 * Step 1: Add to /ip/hotspot/user (enables mac auto-auth)
 * Step 2: Try /ip/hotspot/active/add to force-create session immediately.
 *         This removes the need for the browser to make a triggering request.
 *         Correct params (from testing): =address= =mac-address= =user=
 *         If this traps, log it and let ConnectingPage handle activation.
 */
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
    // ── Step 1: Add to hotspot user table ──────────────────────────────────
    const existing = await runCommands([['/ip/hotspot/user/print', `?mac-address=${normMac}`]]);
    for (const u of getReplies(existing, 0)) {
      if (u['.id']) {
        await runCommands([['/ip/hotspot/user/remove', `=.id=${u['.id']}`]]);
        console.log(`[MikroTik] Removed stale user entry for ${normMac}`);
      }
    }

    await runCommands([[
      '/ip/hotspot/user/add',
      `=name=${normMac}`,
      `=mac-address=${normMac}`,
      `=profile=default`,
      `=limit-uptime=${uptime}`,
      `=comment=CityNet ${new Date().toISOString().slice(0, 10)}`,
    ]]);
    console.log(`✅ [MikroTik] User added: ${normMac} uptime=${uptime}`);

    // ── Step 2: Force-create active session via active/add ─────────────────
    // Probe showed active/add exists but "server" is not a valid param.
    // Try without server param — RouterOS assigns to the hotspot automatically.
    const clientIp = knownIp || null;

    if (clientIp) {
      const addRes = await runCommands([[
        '/ip/hotspot/active/add',
        `=address=${clientIp}`,
        `=mac-address=${normMac}`,
        `=user=${normMac}`,
      ]]);

      const trap = getTrap(addRes, 0);
      if (trap) {
        // Try with to-address instead of address
        const addRes2 = await runCommands([[
          '/ip/hotspot/active/add',
          `=to-address=${clientIp}`,
          `=mac-address=${normMac}`,
          `=user=${normMac}`,
        ]]);
        const trap2 = getTrap(addRes2, 0);
        if (trap2) {
          console.warn(`[MikroTik] active/add not available: ${JSON.stringify(trap2)}`);
          console.log(`   → ConnectingPage will trigger auto-auth via browser navigation`);
          return { ok: true, mock: false, activeSession: false, clientIp };
        }
      }

      // Verify session appeared
      await new Promise(r => setTimeout(r, 400));
      const verify = await runCommands([['/ip/hotspot/active/print', `?mac-address=${normMac}`]]);
      const active = getReplies(verify, 0).length > 0;
      console.log(`✅ [MikroTik] active/add succeeded: ${normMac} @ ${clientIp} | verified=${active}`);
      return { ok: true, mock: false, activeSession: active, clientIp };
    }

    console.log(`[MikroTik] No client IP — skipping active/add. Auto-auth on next browser request.`);
    return { ok: true, mock: false, activeSession: false, clientIp: null };

  } catch (err) {
    console.error(`❌ [MikroTik] grantAccess failed for ${normMac}:`, err.message);
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

// ── Utilities ─────────────────────────────────────────────────────────────────

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
    const row = getReplies(r, 0)[0];
    const identity = row?.name || HS_HOST;
    return { ok: true, mode: 'api', identity, host: HS_HOST, port: API_PORT };
  } catch (err) {
    return { ok: false, mode: 'api', host: HS_HOST, port: API_PORT, error: err.message };
  }
}

module.exports = { grantAccess, revokeAccess, listAuthorizedClients, testConnection };
