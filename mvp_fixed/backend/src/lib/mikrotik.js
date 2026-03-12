'use strict';
/**
 * MikroTik Hotspot integration — browser-redirect model
 *
 * How MikroTik Hotspot works:
 *  1. Client connects to Wi-Fi, tries to browse
 *  2. MikroTik redirects to: http://captive.local/?mac=XX&ip=YY&dst=http://original
 *  3. Portal shows video/survey flow (this app)
 *  4. After completion, portal redirects browser to MikroTik login URL:
 *     http://192.168.88.1/login?username=<mac>&password=<mac>&dst=<original>
 *  5. MikroTik authenticates the MAC and redirects to dst
 *  6. Session lives in RouterOS natively — survives reboots
 *
 * No RouterOS API. No credentials. No library. Just a URL redirect.
 */

// MOCK mode is controlled ONLY by MIKROTIK_MOCK env var.
// Do NOT fall back to NODE_ENV — production Pi with MIKROTIK_MOCK=false must use the real router.
const MOCK     = process.env.MIKROTIK_MOCK === 'true';
const HS_HOST  = process.env.MIKROTIK_HOST    || '192.168.88.1';
const HS_PORT  = process.env.MIKROTIK_HS_PORT || '80';
const SUCCESS  = process.env.SUCCESS_REDIRECT || 'http://www.google.com';

/**
 * Build the MikroTik Hotspot login URL the browser should be redirected to.
 * MikroTik uses MAC as both username and password (default Hotspot config).
 * The router grants access when it receives this GET from the client's browser.
 *
 * @param {string} mac  - Client MAC address (from MikroTik's redirect param)
 * @param {string} dst  - Original destination URL (from MikroTik's ?dst= param)
 * @returns {{ url: string, mock: boolean }}
 */
function buildLoginUrl(mac, dst) {
  const target = dst || SUCCESS;

  if (MOCK) {
    // In mock/dev mode return the success URL directly — no router to call
    console.log(`[MOCK] Hotspot login: mac=${mac} dst=${target}`);
    return { url: target, mock: true };
  }

  if (!mac) {
    // No MAC — MikroTik wasn't involved (direct dev access). Go straight to success.
    console.warn('⚠️  No MAC address — returning success URL directly');
    return { url: target, mock: false, noMac: true };
  }

  const port   = HS_PORT === '80' ? '' : `:${HS_PORT}`;
  const login  = `http://${HS_HOST}${port}/login`
    + `?username=${encodeURIComponent(mac)}`
    + `&password=${encodeURIComponent(mac)}`
    + `&dst=${encodeURIComponent(target)}`;

  return { url: login, mock: false };
}

/**
 * Build the MikroTik Hotspot logout URL.
 * Redirect the browser here to revoke access.
 */
function buildLogoutUrl(mac) {
  if (MOCK) return { url: '/', mock: true };
  const port = HS_PORT === '80' ? '' : `:${HS_PORT}`;
  return { url: `http://${HS_HOST}${port}/logout?username=${encodeURIComponent(mac)}`, mock: false };
}

/**
 * Test connectivity to the hotspot host.
 * Simple HTTP HEAD request — no auth needed.
 */
async function testConnection() {
  if (MOCK) return { ok: true, mode: 'mock', identity: 'MOCK-HOTSPOT-ROUTER' };
  const http = require('http');
  return new Promise(resolve => {
    const req = http.request(
      { host: HS_HOST, port: Number(HS_PORT), path: '/', method: 'HEAD', timeout: 5000 },
      res => resolve({ ok: true, mode: 'hotspot', status: res.statusCode, host: HS_HOST })
    );
    req.on('error',   () => resolve({ ok: false, mode: 'hotspot', host: HS_HOST, error: 'Connection refused' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, mode: 'hotspot', host: HS_HOST, error: 'Timeout' }); });
    req.end();
  });
}

/**
 * List active Hotspot sessions — read from RouterOS HTTP API (optional/best-effort).
 * Returns empty array if router is unreachable or in mock mode.
 */
async function listAuthorizedClients() {
  if (MOCK) return [
    { address: '192.168.88.10', mac: '02:00:c0:a8:58:0a', uptime: '01:23:00', name: 'mock-user-1' },
    { address: '192.168.88.11', mac: '02:00:c0:a8:58:0b', uptime: '00:45:00', name: 'mock-user-2' },
  ];
  // Real mode: RouterOS doesn't expose a simple unauthenticated hotspot active list.
  // We return the Pi's DB-based active sessions instead (handled in admin.js stats).
  return [];
}

module.exports = { buildLoginUrl, buildLogoutUrl, testConnection, listAuthorizedClients };
