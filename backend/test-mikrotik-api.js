#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { testConnection, grantAccess, revokeAccess, listAuthorizedClients } = require('./src/lib/mikrotik');
const [,, cmd, macArg, ipArg] = process.argv;

async function main() {
  const host    = process.env.MIKROTIK_HOST     || '192.168.88.1';
  const port    = process.env.MIKROTIK_API_PORT || '8728';
  const user    = process.env.MIKROTIK_API_USER || 'pi-api';
  const hotspot = process.env.MIKROTIK_HOTSPOT  || 'hotspot1';
  const mock    = process.env.MIKROTIK_MOCK;

  console.log(`\n🔌 MikroTik API Test`);
  console.log(`   ${host}:${port}  user=${user}  hotspot=${hotspot}  mock=${mock}\n`);

  const conn = await testConnection();
  if (!conn.ok) {
    console.error(`❌ Cannot connect: ${conn.error}`);
    process.exit(1);
  }
  console.log(`✅ Connected — router identity: "${conn.identity}"\n`);

  if (cmd === 'grant') {
    if (!macArg) { console.error('Usage: node test-mikrotik-api.js grant MAC [IP]'); process.exit(1); }
    console.log(`Granting ${macArg}${ipArg ? ` @ ${ipArg}` : ''}...`);
    const r = await grantAccess(macArg, 1, ipArg || null);
    console.log(r.ok ? '✅ Grant OK' : `❌ Grant failed: ${r.error}`);
    console.log(`   activeSession: ${r.activeSession}`);
    console.log(`   clientIp:      ${r.clientIp || 'unknown'}`);
    if (r.warning) console.log(`   warning: ${r.warning}`);
    console.log(`\nVerify:\n  /ip hotspot user print where mac-address=${macArg.toUpperCase()}\n  /ip hotspot active print`);
    return;
  }

  if (cmd === 'revoke') {
    if (!macArg) { console.error('Usage: node test-mikrotik-api.js revoke MAC'); process.exit(1); }
    const r = await revokeAccess(macArg);
    console.log(r.ok ? `✅ Revoked ${macArg}` : `❌ ${r.error}`);
    return;
  }

  const clients = await listAuthorizedClients();
  console.log(`Active sessions: ${clients.length}`);
  clients.forEach(c => console.log(`  • ${c['mac-address']}  ${c.address}  uptime=${c.uptime}`));

  console.log('\nCommands:');
  console.log('  node test-mikrotik-api.js grant  AA:BB:CC:DD:EE:FF [192.168.88.x]');
  console.log('  node test-mikrotik-api.js revoke AA:BB:CC:DD:EE:FF');
}

main().catch(e => { console.error(e); process.exit(1); });
