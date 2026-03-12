'use strict';
/**
 * MikroTik Hotspot — RouterOS Binary API (port 8728)
 *
 * GRANT STRATEGY — two steps:
 *
 *  1. /ip/hotspot/user/add (with mac-address=)
 *     Creates the user record. With login-by=mac, RouterOS uses this to
 *     auto-authenticate the MAC on any subsequent packet.
 *
 *  2. /ip/hotspot/active/login
 *     Force-creates an active session immediately, bypassing the need for
 *     any browser-side action. The client gets internet without navigating
 *     to 192.168.88.1/login at all.
 *
 *     Required: ip= (client's current IP address)
 *     We get this from: session DB → request body → X-Real-IP header (in that order)
 *
 * WHY 192.168.88.1/login DOESN'T WORK FROM THE BROWSER:
 *   Unauthenticated clients' HTTP requests are intercepted by the hotspot
 *   engine BEFORE they reach the router's web server. The /login path is
 *   only reachable AFTER the session is active — but we need to activate
 *   it first. Catch-22 solved by using the API from the Pi instead.
 */

const net = require('net');

const MOCK     = process.env.MIKROTIK_MOCK     === 'true';
const HS_HOST  = process.env.MIKROTIK_HOST     || '192.168.88.1';
const API_PORT = parseInt(process.env.MIKROTIK_API_PORT || '8728', 10);
const API_USER = process.env.MIKROTIK_API_USER || 'pi-api';
const API_PASS = process.env.MIKROTIK_API_PASS || '';
const HS_NAME  = process.env.MIKROTIK_HOTSPOT  || 'hotspot1';

// ── RouterOS Binary API protocol ────────────────────────────────────────────

function encodeLength(len) {
  if (len < 0x80)       return Buffer.from([len]);
  if (len < 0x4000)     return Buffer.from([(len >> 8) | 0x80, len & 0xFF]);
  if (len < 0x200000)   return Buffer.from([(len >> 16) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
  if (len < 0x10000000) return Buffer.from([(len >> 24) | 0xE0, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
  throw new Error(`Word too long: ${len}`);
}
function encodeWord(w)  { const b = Buffer.from(w, 'utf8'); return Buffer.concat([encodeLength(b.length), b]); }
function encodeSentence(words) { return Buffer.concat([...words.map(encodeWord), Buffer.from([0x00])]); }

function decodeSentences(buf) {
  const sentences = []; let cur = [], i = 0;
  while (i < buf.length) {
    const b0 = buf[i];
    let len, skip;
    if      ((b0 & 0xE0) === 0xE0) { len = ((b0&0x1F)<<24)|(buf[i+1]<<16)|(buf[i+2]<<8)|buf[i+3]; skip=4; }
    else if ((b0 & 0xC0) === 0xC0) { len = ((b0&0x3F)<<16)|(buf[i+1]<<8)|buf[i+2];                 skip=3; }
    else if ((b0 & 0x80) === 0x80) { len = ((b0&0x7F)<<8)|buf[i+1];                                 skip=2; }
    else                            { len = b0;                                                        skip=1; }
    i += skip;
    if (len === 0) { if (cur.length) { sentences.push(cur); cur = []; } }
    else           { cur.push(buf.slice(i, i+len).toString('utf8')); i += len; }
  }
  return sentences;
}
function parseSentence(words) {
  const type = words[0] || '', attrs = {};
  for (const w of words.slice(1)) { const eq = w.indexOf('='); if (eq>0) attrs[w.slice(1,eq)] = w.slice(eq+1); }
  return { type, attrs };
}

function runCommands(commands) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const results = []; let buf = Buffer.alloc(0), cmdIdx = 0, loggedIn = false;

    const timer = setTimeout(() => { socket.destroy(); reject(new Error('API timeout (10s)')); }, 10000);

    socket.connect(API_PORT, HS_HOST, () => {
      socket.write(encodeSentence(['/login', `=name=${API_USER}`, `=password=${API_PASS}`]));
    });

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (const words of decodeSentences(buf)) {
        const p = parseSentence(words);
        if (!loggedIn) {
          if (p.type === '!done') { loggedIn = true; socket.write(encodeSentence(commands[0])); }
          else if (p.type === '!trap') { clearTimeout(timer); socket.destroy(); reject(new Error(`Login: ${p.attrs.message}`)); }
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
      buf = Buffer.alloc(0);
    });

    socket.on('error', err => { clearTimeout(timer); reject(err); });
    socket.on('close', () => {
      clearTimeout(timer);
      if (cmdIdx >= commands.length) resolve(results);
      else reject(new Error('Connection closed early'));
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getReplies(results, idx) {
  return (results[idx] || []).filter(r => r.type === '!re').map(r => r.attrs);
}

// ── Public API ───────────────────────────────────────────────────────────────

async function grantAccess(mac, sessionHours, knownIp = null) {
  if (MOCK) {
    console.log(`[MOCK] grantAccess mac=${mac} hours=${sessionHours}`);
    return { ok: true, mock: true, activeSession: true };
  }
  if (!mac) return { ok: false, mock: false, error: 'No MAC address' };

  const normMac = mac.toUpperCase();
  const h = String(Math.floor(sessionHours)).padStart(2,'0');
  const m = String(Math.round((sessionHours%1)*60)).padStart(2,'0');
  const uptime = `${h}:${m}:00`;

  try {
    // ── Step 1: Create/replace hotspot user ──────────────────────────────
    const findRes = await runCommands([['/ip/hotspot/user/print', `?mac-address=${normMac}`]]);
    for (const u of getReplies(findRes, 0)) {
      if (u['.id']) {
        await runCommands([['/ip/hotspot/user/remove', `=.id=${u['.id']}`]]);
        console.log(`[MikroTik] Removed old user entry for ${normMac}`);
      }
    }
    await runCommands([[
      '/ip/hotspot/user/add',
      `=name=${normMac}`, `=mac-address=${normMac}`,
      `=profile=default`, `=limit-uptime=${uptime}`,
      `=comment=CityNet ${new Date().toISOString().slice(0,10)}`,
    ]]);
    console.log(`[MikroTik] User added: ${normMac} uptime=${uptime}`);

    // ── Step 2: Resolve client IP ─────────────────────────────────────────
    let clientIp = knownIp || null;

    if (!clientIp) {
      // Try DHCP lease table by MAC
      const leaseByMac = await runCommands([['/ip/dhcp-server/lease/print', `?mac-address=${normMac}`]]);
      for (const l of getReplies(leaseByMac, 0)) {
        if (l.address) { clientIp = l.address; break; }
      }
    }

    if (!clientIp) {
      // Try all active leases and find one in our pool
      console.log(`[MikroTik] No lease by MAC, scanning all leases...`);
      const allLeases = await runCommands([['/ip/dhcp-server/lease/print']]);
      for (const l of getReplies(allLeases, 0)) {
        if (l.address && l.address.startsWith('192.168.88.') && l.address !== '192.168.88.1' && l.address !== '192.168.88.2') {
          // Check if this lease's MAC matches (RouterOS may store MAC differently)
          const lMac = (l['mac-address'] || '').toUpperCase();
          if (lMac === normMac || lMac.replace(/:/g,'') === normMac.replace(/:/g,'')) {
            clientIp = l.address;
            break;
          }
        }
      }
    }

    if (!clientIp) {
      console.warn(`[MikroTik] Cannot determine IP for ${normMac}. User added; session will auto-activate on first packet.`);
      return { ok: true, mock: false, activeSession: false };
    }

    console.log(`[MikroTik] Client IP resolved: ${clientIp} (knownIp=${knownIp})`);

    // ── Step 3: Force-activate session via active/login ───────────────────
    const loginRes = await runCommands([[
      '/ip/hotspot/active/login',
      `=ip=${clientIp}`,
      `=mac-address=${normMac}`,
      `=user=${normMac}`,
      `=password=`,
      `=server=${HS_NAME}`,
    ]]);

    const loginReplies = loginRes[0] || [];
    const trap = loginReplies.find(r => r.type === '!trap');
    if (trap) {
      console.warn(`[MikroTik] active/login trap: "${trap.attrs.message}" — trying alternative activation`);

      // ── Fallback: use /ip/hotspot/active/print to check if already active ──
      // Sometimes the session was already activated between user/add and active/login
      const activeCheck = await runCommands([['/ip/hotspot/active/print', `?mac-address=${normMac}`]]);
      const activeSessions = getReplies(activeCheck, 0);
      if (activeSessions.length > 0) {
        console.log(`[MikroTik] Session already active for ${normMac} — trap was spurious`);
        return { ok: true, mock: false, activeSession: true, clientIp };
      }

      // Not active. The auto-login on next packet will still work since user is in /ip/hotspot/user.
      return { ok: true, mock: false, activeSession: false, clientIp, warning: trap.attrs.message };
    }

    // Verify session actually exists now
    await new Promise(r => setTimeout(r, 500)); // small delay for RouterOS to commit
    const verify = await runCommands([['/ip/hotspot/active/print', `?mac-address=${normMac}`]]);
    const verified = getReplies(verify, 0).length > 0;
    console.log(`✅ [MikroTik] Grant complete: ${normMac} @ ${clientIp} | active=${verified}`);

    return { ok: true, mock: false, activeSession: verified, clientIp };

  } catch (err) {
    console.error(`❌ [MikroTik] grantAccess failed for ${normMac}:`, err.message);
    return { ok: false, mock: false, error: err.message };
  }
}

async function revokeAccess(mac) {
  if (MOCK) return { ok: true, mock: true };
  const normMac = mac.toUpperCase();
  try {
    const find = await runCommands([['/ip/hotspot/user/print', `?mac-address=${normMac}`]]);
    for (const u of getReplies(find, 0)) {
      if (u['.id']) await runCommands([['/ip/hotspot/user/remove', `=.id=${u['.id']}`]]);
    }
    const active = await runCommands([['/ip/hotspot/active/print', `?mac-address=${normMac}`]]);
    for (const a of getReplies(active, 0)) {
      if (a['.id']) await runCommands([['/ip/hotspot/active/remove', `=.id=${a['.id']}`]]);
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
