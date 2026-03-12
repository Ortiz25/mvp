#!/usr/bin/env node
/**
 * MikroTik API Test
 * 
 * Tests the two fixes applied in this version:
 *   1. password=MAC now set in user/add (was missing — caused silent mac-auth fail)
 *   2. active/login now sent WITHOUT server= param (was causing empty trap)
 *
 * Usage:
 *   node backend/test-mikrotik-api.js                    — connection test + active list
 *   node backend/test-mikrotik-api.js grant MAC [IP]     — full grant sequence
 *   node backend/test-mikrotik-api.js revoke MAC         — revoke
 *   node backend/test-mikrotik-api.js active             — list active sessions
 *   node backend/test-mikrotik-api.js verify MAC         — check if MAC is authorized
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { testConnection, grantAccess, revokeAccess, listAuthorizedClients } = require('./src/lib/mikrotik');
const [,, cmd, macArg, ipArg] = process.argv;

async function main() {
  console.log(`\n🔌 MikroTik API — ${process.env.MIKROTIK_HOST||'192.168.88.1'}:${process.env.MIKROTIK_API_PORT||'8728'}`);
  console.log(`   user=${process.env.MIKROTIK_API_USER||'pi-api'}  hotspot=${process.env.MIKROTIK_HOTSPOT||'hotspot1'}  mock=${process.env.MIKROTIK_MOCK}\n`);

  const conn = await testConnection();
  if (!conn.ok) { console.error(`❌ Cannot connect: ${conn.error}`); process.exit(1); }
  console.log(`✅ Connected — router: "${conn.identity}"\n`);

  if (cmd === 'grant') {
    if (!macArg) { console.error('Usage: node test-mikrotik-api.js grant MAC [IP]'); process.exit(1); }
    console.log(`Granting access: MAC=${macArg}${ipArg ? `  IP=${ipArg}` : ''}`);
    console.log(`Fixes applied: password=MAC in user/add, no server= in active/login\n`);
    const r = await grantAccess(macArg, 1, ipArg || null);
    if (r.ok) {
      console.log(`\n✅ Grant succeeded`);
      console.log(`   activeSession: ${r.activeSession}  (true = internet live immediately)`);
      console.log(`   clientIp:      ${r.clientIp}`);
      if (!r.activeSession) {
        console.log(`\n   ⚡ Session not yet active — browser redirect needed.`);
        console.log(`   Open on phone: http://192.168.88.1/login?username=${macArg}&password=${macArg}&dst=http://www.google.com`);
      }
    } else {
      console.log(`\n❌ Grant failed: ${r.error}`);
    }
    return;
  }

  if (cmd === 'revoke') {
    if (!macArg) { console.error('Usage: node test-mikrotik-api.js revoke MAC'); process.exit(1); }
    const r = await revokeAccess(macArg);
    console.log(r.ok ? `✅ Revoked ${macArg}` : `❌ ${r.error}`);
    return;
  }

  if (cmd === 'active') {
    const clients = await listAuthorizedClients();
    console.log(`Active hotspot sessions: ${clients.length}`);
    clients.forEach(c => console.log(`  • ${c['mac-address']}  ${c.address || c['to-address']}  uptime=${c.uptime}  user=${c.user}`));
    return;
  }

  const clients = await listAuthorizedClients();
  console.log(`Active sessions: ${clients.length}`);
  clients.forEach(c => console.log(`  • ${c['mac-address']}  ${c.address||c['to-address']}  uptime=${c.uptime}`));
  console.log('\nCommands: grant MAC [IP] | revoke MAC | active');
}

main().catch(e => { console.error(e.message); process.exit(1); });
