#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { testConnection, grantAccess, revokeAccess, listAuthorizedClients } = require('./src/lib/mikrotik');
const [,, cmd, macArg, ipArg] = process.argv;

async function main() {
  const cfg = {
    host:    process.env.MIKROTIK_HOST     || '192.168.88.1',
    port:    process.env.MIKROTIK_API_PORT || '8728',
    user:    process.env.MIKROTIK_API_USER || 'pi-api',
    hotspot: process.env.MIKROTIK_HOTSPOT  || 'hotspot1',
    mock:    process.env.MIKROTIK_MOCK,
  };
  console.log(`\n🔌 MikroTik API  ${cfg.host}:${cfg.port}  user=${cfg.user}  hotspot=${cfg.hotspot}  mock=${cfg.mock}\n`);

  const conn = await testConnection();
  if (!conn.ok) { console.error(`❌ Cannot connect: ${conn.error}`); process.exit(1); }
  console.log(`✅ Connected — router: "${conn.identity}"\n`);

  if (cmd === 'grant') {
    if (!macArg) { console.error('Usage: node test-mikrotik-api.js grant MAC [IP]'); process.exit(1); }
    console.log(`Granting ${macArg}${ipArg ? ` @ ${ipArg}` : ''}...`);
    const r = await grantAccess(macArg, 1, ipArg || null);
    console.log(r.ok ? '✅ Grant OK' : `❌ ${r.error}`);
    console.log(`   activeSession: ${r.activeSession}`);
    console.log(`   clientIp:      ${r.clientIp}`);
    if (r.warning) console.log(`   warning: ${r.warning}`);
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
    console.log(`Active sessions: ${clients.length}`);
    clients.forEach(c => console.log(`  • ${c['mac-address']}  ${c.address}  uptime=${c.uptime}`));
    return;
  }

  console.log('Commands:');
  console.log('  node test-mikrotik-api.js grant  AA:BB:CC:DD:EE:FF [192.168.88.x]');
  console.log('  node test-mikrotik-api.js revoke AA:BB:CC:DD:EE:FF');
  console.log('  node test-mikrotik-api.js active');
}

main().catch(e => { console.error(e.message); process.exit(1); });
