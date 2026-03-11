'use strict';
const { RouterOSAPI } = require('node-routeros');
const MOCK = process.env.MIKROTIK_MOCK === 'true' || process.env.NODE_ENV !== 'production';
const LIST = 'authorized-clients';

function client() {
  return new RouterOSAPI({
    host:     process.env.MIKROTIK_HOST     || '192.168.88.1',
    user:     process.env.MIKROTIK_USER     || 'captive-api',
    password: process.env.MIKROTIK_PASSWORD || 'changeme',
    port:     Number(process.env.MIKROTIK_PORT) || 8728,
    timeout:  12,
  });
}

async function grantAccess(ip, sessionId, hours = 8) {
  if (MOCK) { console.log(`[MOCK] grant ${ip} ${hours}h`); return { success: true }; }
  const api = client();
  try {
    await api.connect();
    const existing = await api.write('/ip/firewall/address-list/print', [`?list=${LIST}`, `?address=${ip}`]);
    for (const e of existing) if (e['.id']) await api.write('/ip/firewall/address-list/remove', [`=.id=${e['.id']}`]);
    await api.write('/ip/firewall/address-list/add', [`=list=${LIST}`, `=address=${ip}`, `=timeout=${hours}h`, `=comment=captive-${sessionId}`]);
    await api.close();
    console.log(`✅ Access granted: ${ip} ${hours}h`);
    return { success: true };
  } catch (err) {
    await api.close().catch(() => {});
    console.error(`❌ MikroTik grant failed ${ip}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function revokeAccess(ip) {
  if (MOCK) { console.log(`[MOCK] revoke ${ip}`); return { success: true }; }
  const api = client();
  try {
    await api.connect();
    const list = await api.write('/ip/firewall/address-list/print', [`?list=${LIST}`, `?address=${ip}`]);
    for (const e of list) if (e['.id']) await api.write('/ip/firewall/address-list/remove', [`=.id=${e['.id']}`]);
    await api.close();
    return { success: true };
  } catch (err) {
    await api.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

async function getMacFromArp(ip) {
  if (MOCK) {
    const o = ip.split('.');
    if (o.length === 4) return `02:00:${o.map(x => parseInt(x).toString(16).padStart(2,'0')).join(':')}`.slice(0,17);
    return null;
  }
  const api = client();
  try {
    await api.connect();
    const rows = await api.write('/ip/arp/print', [`?address=${ip}`]);
    await api.close();
    return rows[0]?.['mac-address'] || null;
  } catch { await api.close().catch(() => {}); return null; }
}

async function listAuthorizedClients() {
  if (MOCK) return [
    { address: '192.168.88.10', timeout: '07:45:00', comment: 'captive-mock-1' },
    { address: '192.168.88.11', timeout: '03:12:00', comment: 'captive-mock-2' },
  ];
  const api = client();
  try {
    await api.connect();
    const list = await api.write('/ip/firewall/address-list/print', [`?list=${LIST}`]);
    await api.close();
    return list.map(e => ({ address: String(e.address||''), timeout: String(e.timeout||''), comment: String(e.comment||'') }));
  } catch { await api.close().catch(() => {}); return []; }
}

async function testConnection() {
  if (MOCK) return { ok: true, identity: 'MOCK-ROUTER' };
  const api = client();
  try {
    await api.connect();
    const info = await api.write('/system/identity/print');
    await api.close();
    return { ok: true, identity: info[0]?.name || 'unknown' };
  } catch (err) {
    await api.close().catch(() => {});
    return { ok: false, error: err.message };
  }
}

module.exports = { grantAccess, revokeAccess, getMacFromArp, listAuthorizedClients, testConnection };
