'use strict';
/**
 * MikroTik Hotspot integration — RouterOS Binary API (port 8728)
 *
 * WHY BINARY API:
 *   - REST API (/rest) returns 404 on this router — not enabled
 *   - Port 8728 (RouterOS API) is confirmed open and working
 *   - The binary API is RouterOS's native management protocol
 *   - Pure Node.js TCP implementation — zero npm dependencies
 *
 * PROTOCOL OVERVIEW (RouterOS API Sentence protocol):
 *   Every message is a "sentence" — a list of words, terminated by an empty word.
 *   Each word is length-prefixed using a variable-length encoding:
 *     len < 0x80        → 1 byte
 *     len < 0x4000      → 2 bytes, first byte OR'd with 0x80
 *     len < 0x200000    → 3 bytes, first byte OR'd with 0xC0
 *     len < 0x10000000  → 4 bytes, first byte OR'd with 0xE0
 *   An empty word (single 0x00 byte) terminates the sentence.
 *
 *   Login flow (RouterOS 7.x):
 *     → /login name=USER password=PASS
 *     ← !done  (success) or !trap message=... (error)
 *
 *   Add hotspot user:
 *     → /ip/hotspot/user/add name=MAC mac-address=MAC profile=default limit-uptime=HH:MM:SS
 *     ← !done
 *
 * MIKROTIK SETUP (one-time, run in Winbox Terminal):
 *   /user add name=pi-api password=CHANGE_ME group=full comment="Pi API"
 *
 * ENV VARS:
 *   MIKROTIK_HOST        192.168.88.1
 *   MIKROTIK_API_PORT    8728         (RouterOS binary API port)
 *   MIKROTIK_API_USER    pi-api
 *   MIKROTIK_API_PASS    CHANGE_ME
 *   MIKROTIK_MOCK        false
 */

const net  = require('net');

const MOCK     = process.env.MIKROTIK_MOCK === 'true';
const HS_HOST  = process.env.MIKROTIK_HOST     || '192.168.88.1';
const HS_PORT  = parseInt(process.env.MIKROTIK_HS_PORT  || '80',   10);
const API_PORT = parseInt(process.env.MIKROTIK_API_PORT || '8728', 10);
const API_USER = process.env.MIKROTIK_API_USER || 'pi-api';
const API_PASS = process.env.MIKROTIK_API_PASS || '';
const SUCCESS  = process.env.SUCCESS_REDIRECT  || 'http://www.google.com';

// ── RouterOS Binary API implementation ─────────────────────────────────────

/**
 * Encode a word length into the RouterOS variable-length format.
 * @param {number} len
 * @returns {Buffer}
 */
function encodeLength(len) {
  if (len < 0x80) {
    return Buffer.from([len]);
  } else if (len < 0x4000) {
    return Buffer.from([(len >> 8) | 0x80, len & 0xFF]);
  } else if (len < 0x200000) {
    return Buffer.from([(len >> 16) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
  } else if (len < 0x10000000) {
    return Buffer.from([(len >> 24) | 0xE0, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
  }
  throw new Error(`Word too long: ${len}`);
}

/**
 * Encode a single word (length-prefixed string).
 * @param {string} word
 * @returns {Buffer}
 */
function encodeWord(word) {
  const wordBuf = Buffer.from(word, 'utf8');
  return Buffer.concat([encodeLength(wordBuf.length), wordBuf]);
}

/**
 * Encode a full sentence (array of words + empty terminator).
 * @param {string[]} words
 * @returns {Buffer}
 */
function encodeSentence(words) {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0x00])); // empty word = end of sentence
  return Buffer.concat(parts);
}

/**
 * Decode all sentences from a received buffer.
 * Returns { sentences: string[][], remaining: Buffer }
 * A sentence is complete when an empty word (length 0) is encountered.
 */
function decodeSentences(buf) {
  const sentences = [];
  let current     = [];
  let i           = 0;

  while (i < buf.length) {
    // Decode length
    let len;
    const b0 = buf[i];
    if ((b0 & 0x80) === 0x00) {
      len = b0; i += 1;
    } else if ((b0 & 0xC0) === 0x80) {
      if (i + 1 >= buf.length) break; // incomplete
      len = ((b0 & 0x3F) << 8) | buf[i + 1]; i += 2;
    } else if ((b0 & 0xE0) === 0xC0) {
      if (i + 2 >= buf.length) break;
      len = ((b0 & 0x1F) << 16) | (buf[i + 1] << 8) | buf[i + 2]; i += 3;
    } else if ((b0 & 0xF0) === 0xE0) {
      if (i + 3 >= buf.length) break;
      len = ((b0 & 0x0F) << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]; i += 4;
    } else {
      i++; continue; // skip unknown
    }

    if (len === 0) {
      // End of sentence
      sentences.push(current);
      current = [];
    } else {
      if (i + len > buf.length) {
        // Word not fully received yet — rewind
        i -= (b0 & 0x80) === 0 ? 1 : (b0 & 0xC0) === 0x80 ? 2 : (b0 & 0xE0) === 0xC0 ? 3 : 4;
        break;
      }
      current.push(buf.slice(i, i + len).toString('utf8'));
      i += len;
    }
  }

  return { sentences, remaining: buf.slice(i) };
}

/**
 * Parse a RouterOS API sentence into a structured reply.
 * @param {string[]} sentence
 * @returns {{ type: string, attrs: object, message?: string }}
 */
function parseSentence(sentence) {
  if (!sentence.length) return { type: '', attrs: {} };
  const type  = sentence[0]; // !done, !re, !trap, !fatal
  const attrs = {};
  for (let i = 1; i < sentence.length; i++) {
    const word = sentence[i];
    if (word.startsWith('=')) {
      const eq  = word.indexOf('=', 1);
      const key = word.slice(1, eq);
      const val = word.slice(eq + 1);
      attrs[key] = val;
    }
  }
  return { type, attrs, message: attrs.message };
}

/**
 * Execute a list of commands on the RouterOS API.
 * Handles login automatically, then runs each command sentence.
 *
 * @param {string[][]} commands - Array of sentences, each sentence is an array of words
 * @returns {Promise<{ type: string, attrs: object }[][]>} replies per command
 */
function runCommands(commands) {
  return new Promise((resolve, reject) => {
    const socket  = new net.Socket();
    let   buf     = Buffer.alloc(0);
    const results = []; // replies for each command
    let   phase   = 'login'; // login → commands → done
    let   cmdIdx  = 0;
    let   cmdReplies = [];

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('RouterOS API timeout'));
    }, 10000);

    const send = words => socket.write(encodeSentence(words));

    socket.connect(API_PORT, HS_HOST, () => {
      // Send login command
      send(['/login', `=name=${API_USER}`, `=password=${API_PASS}`]);
    });

    socket.on('data', data => {
      buf = Buffer.concat([buf, data]);
      const { sentences, remaining } = decodeSentences(buf);
      buf = remaining;

      for (const sentence of sentences) {
        if (!sentence.length) continue;
        const reply = parseSentence(sentence);

        if (phase === 'login') {
          if (reply.type === '!done') {
            // Login succeeded — start sending commands
            phase = 'commands';
            if (commands.length === 0) {
              clearTimeout(timeout);
              socket.destroy();
              resolve([]);
              return;
            }
            send(commands[cmdIdx]);
          } else if (reply.type === '!trap' || reply.type === '!fatal') {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error(`RouterOS login failed: ${reply.message || sentence.join(' ')}`));
          }
        } else if (phase === 'commands') {
          cmdReplies.push(reply);

          if (reply.type === '!done' || reply.type === '!trap' || reply.type === '!fatal') {
            results.push(cmdReplies);
            cmdReplies = [];
            cmdIdx++;

            if (cmdIdx >= commands.length) {
              // All commands done
              clearTimeout(timeout);
              send(['/quit']);
              socket.destroy();
              phase = 'done';
              resolve(results);
            } else {
              send(commands[cmdIdx]);
            }
          }
        }
      }
    });

    socket.on('error', err => {
      clearTimeout(timeout);
      reject(new Error(`RouterOS API connection error: ${err.message}`));
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      if (phase !== 'done') {
        reject(new Error('RouterOS API connection closed unexpectedly'));
      }
    });
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Grant internet access to a client MAC via RouterOS binary API.
 * Adds the MAC as a /ip/hotspot/user entry. RouterOS auto-authenticates
 * the MAC on its next packet (within 1-2 seconds).
 *
 * @param {string} mac          - e.g. "F6:AC:AF:60:6A:A7"
 * @param {number} sessionHours - e.g. 1
 * @returns {Promise<{ ok: boolean, mock: boolean, error?: string }>}
 */
async function grantAccess(mac, sessionHours) {
  if (MOCK) {
    console.log(`[MOCK] grantAccess: mac=${mac} hours=${sessionHours}`);
    return { ok: true, mock: true };
  }
  if (!mac) {
    console.warn('⚠️  grantAccess called with no MAC');
    return { ok: false, mock: false, error: 'No MAC address' };
  }

  const normMac = mac.toUpperCase();
  const h       = String(Math.floor(sessionHours)).padStart(2, '0');
  const m       = String(Math.round((sessionHours % 1) * 60)).padStart(2, '0');
  const uptime  = `${h}:${m}:00`;

  try {
    // Step 1: remove any existing hotspot user with this MAC (avoid duplicate error)
    // We use /ip/hotspot/user/print with a filter to find it first
    const findResults = await runCommands([
      ['/ip/hotspot/user/print', `?mac-address=${normMac}`],
    ]);

    const findReplies = findResults[0] || [];
    for (const reply of findReplies) {
      if (reply.type === '!re' && reply.attrs['.id']) {
        await runCommands([
          ['/ip/hotspot/user/remove', `=.id=${reply.attrs['.id']}`],
        ]);
        console.log(`[MikroTik] Removed existing hotspot user .id=${reply.attrs['.id']} (${normMac})`);
      }
    }

    // Step 2: add new hotspot user with MAC auth
    await runCommands([
      [
        '/ip/hotspot/user/add',
        `=name=${normMac}`,
        `=mac-address=${normMac}`,
        `=profile=default`,
        `=limit-uptime=${uptime}`,
        `=comment=CityNet ${new Date().toISOString()}`,
      ],
    ]);

    console.log(`✅ [MikroTik] Hotspot user added: mac=${normMac} limit-uptime=${uptime}`);
    return { ok: true, mock: false };

  } catch (err) {
    console.error(`❌ [MikroTik] grantAccess failed for ${normMac}:`, err.message);
    return { ok: false, mock: false, error: err.message };
  }
}

/**
 * Revoke access — remove hotspot user entry and kick active session.
 */
async function revokeAccess(mac) {
  if (MOCK) return { ok: true, mock: true };
  const normMac = mac.toUpperCase();
  try {
    // Find and remove hotspot user
    const findResults = await runCommands([
      ['/ip/hotspot/user/print', `?mac-address=${normMac}`],
    ]);
    const ids = (findResults[0] || [])
      .filter(r => r.type === '!re' && r.attrs['.id'])
      .map(r => r.attrs['.id']);

    if (ids.length) {
      for (const id of ids) {
        await runCommands([['/ip/hotspot/user/remove', `=.id=${id}`]]);
      }
    }

    // Also kick any active session for this MAC
    const activeResults = await runCommands([
      ['/ip/hotspot/active/print', `?mac-address=${normMac}`],
    ]);
    const activeIds = (activeResults[0] || [])
      .filter(r => r.type === '!re' && r.attrs['.id'])
      .map(r => r.attrs['.id']);

    for (const id of activeIds) {
      await runCommands([['/ip/hotspot/active/remove', `=.id=${id}`]]);
    }

    console.log(`[MikroTik] Revoked: ${normMac}`);
    return { ok: true, mock: false };
  } catch (err) {
    console.error(`[MikroTik] revokeAccess failed for ${normMac}:`, err.message);
    return { ok: false, mock: false, error: err.message };
  }
}

/**
 * List active hotspot sessions.
 */
async function listAuthorizedClients() {
  if (MOCK) return [
    { address: '192.168.88.10', 'mac-address': '02:00:C0:A8:58:0A', uptime: '01:23:00' },
    { address: '192.168.88.11', 'mac-address': '02:00:C0:A8:58:0B', uptime: '00:45:00' },
  ];
  try {
    const results = await runCommands([['/ip/hotspot/active/print']]);
    return (results[0] || [])
      .filter(r => r.type === '!re')
      .map(r => r.attrs);
  } catch {
    return [];
  }
}

/**
 * Test connectivity and credentials to the RouterOS API.
 */
async function testConnection() {
  if (MOCK) return { ok: true, mode: 'mock', identity: 'MOCK-HOTSPOT-ROUTER' };
  try {
    const results = await runCommands([['/system/identity/print']]);
    const identity = (results[0] || []).find(r => r.type === '!re')?.attrs?.name || HS_HOST;
    return { ok: true, mode: 'routeros-api', identity, host: HS_HOST, port: API_PORT };
  } catch (err) {
    return { ok: false, mode: 'routeros-api', host: HS_HOST, port: API_PORT, error: err.message };
  }
}

/**
 * Hotspot logout URL (for admin dashboard "kick" button — browser redirect).
 */
function buildLogoutUrl(mac) {
  if (MOCK) return { url: '/', mock: true };
  return {
    url:  `http://${HS_HOST}${HS_PORT !== 80 ? ':' + HS_PORT : ''}/logout?username=${encodeURIComponent(mac)}`,
    mock: false,
  };
}

module.exports = { grantAccess, revokeAccess, listAuthorizedClients, testConnection, buildLogoutUrl };
