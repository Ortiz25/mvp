#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { testConnection, grantAccess, revokeAccess, listAuthorizedClients } = require('./src/lib/mikrotik');
const [,, cmd, mac] = process.argv;

async function main() {
  console.log(`\n🔌 MikroTik API Test`);
  console.log(`   Host:    ${process.env.MIKROTIK_HOST || '192.168.88.1'}:${process.env.MIKROTIK_API_PORT || '8728'}`);
  console.log(`   User:    ${process.env.MIKROTIK_API_USER || 'pi-api'}`);
  console.log(`   Hotspot: ${process.env.MIKROTIK_HOTSPOT || 'hotspot1'}`);
  console.log(`   Mock:    ${process.env.MIKROTIK_MOCK}\n`);

  const conn = await testConnection();
  if (!conn.ok) { console.error(`❌ Connection failed: ${conn.error}`); process.exit(1); }
  console.log(`✅ Connected: "${conn.identity}"\n`);

  if (cmd === 'grant' && mac) {
    console.log(`Granting ${mac} for 1 hour (2 steps: user + active session)...`);
    const r = await grantAccess(mac, 1);
    if (r.ok) {
      console.log(`✅ Granted!`);
      console.log(`   Active session created: ${r.activeSession ? 'YES — internet is live immediately' : 'NO — will auto-activate on first packet'}`);
      if (r.clientIp) console.log(`   Client IP: ${r.clientIp}`);
      if (r.warning)  console.log(`   Warning: ${r.warning}`);
      console.log(`\nVerify on MikroTik:`);
      console.log(`   /ip hotspot user print where mac-address=${mac.toUpperCase()}`);
      console.log(`   /ip hotspot active print`);
    } else {
      console.error(`❌ Grant failed: ${r.error}`);
    }
    return;
  }

  if (cmd === 'revoke' && mac) {
    const r = await revokeAccess(mac);
    console.log(r.ok ? `✅ Revoked ${mac}` : `❌ Failed: ${r.error}`);
    return;
  }

  console.log('Active sessions:');
  const clients = await listAuthorizedClients();
  if (!clients.length) console.log('  (none)');
  else clients.forEach(c => console.log(`  • ${c['mac-address']} ${c.address} uptime=${c.uptime}`));

  console.log('\nUsage:');
  console.log('  node test-mikrotik-api.js grant AA:BB:CC:DD:EE:FF');
  console.log('  node test-mikrotik-api.js revoke AA:BB:CC:DD:EE:FF');
}

main().catch(e => { console.error(e); process.exit(1); });
