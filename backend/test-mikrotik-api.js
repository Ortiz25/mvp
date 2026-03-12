#!/usr/bin/env node
/**
 * test-mikrotik-api.js
 *
 * Run from the Pi to verify RouterOS API connectivity and grant flow:
 *
 *   node test-mikrotik-api.js
 *
 * Or with custom credentials:
 *   MIKROTIK_API_USER=pi-api MIKROTIK_API_PASS=yourpass node test-mikrotik-api.js
 *
 * Or test granting a specific MAC:
 *   node test-mikrotik-api.js grant AA:BB:CC:DD:EE:FF
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { testConnection, grantAccess, revokeAccess, listAuthorizedClients } = require('./src/lib/mikrotik');

const [,, cmd, mac] = process.argv;

async function main() {
  console.log(`\n🔌 RouterOS API Test`);
  console.log(`   Host: ${process.env.MIKROTIK_HOST || '192.168.88.1'}`);
  console.log(`   Port: ${process.env.MIKROTIK_API_PORT || '8728'}`);
  console.log(`   User: ${process.env.MIKROTIK_API_USER || 'pi-api'}`);
  console.log(`   Mock: ${process.env.MIKROTIK_MOCK}\n`);

  // ── 1. Test connection
  console.log('1️⃣  Testing connection + credentials...');
  const conn = await testConnection();
  if (!conn.ok) {
    console.error(`   ❌ FAILED: ${conn.error}`);
    console.error('\n   Check:');
    console.error('   • /user print where name=pi-api  (user exists?)');
    console.error('   • /ip service print  (api port 8728 enabled?)');
    process.exit(1);
  }
  console.log(`   ✅ Connected! Router identity: "${conn.identity}"\n`);

  // ── 2. List active sessions
  console.log('2️⃣  Listing active hotspot sessions...');
  const clients = await listAuthorizedClients();
  if (clients.length === 0) {
    console.log('   (no active sessions)\n');
  } else {
    clients.forEach(c => console.log(`   • ${c['mac-address']} — ${c.address} — uptime ${c.uptime}`));
    console.log();
  }

  // ── 3. Grant test
  if (cmd === 'grant' && mac) {
    console.log(`3️⃣  Granting access to ${mac} for 1 hour...`);
    const result = await grantAccess(mac, 1);
    if (result.ok) {
      console.log(`   ✅ Granted!\n`);
      console.log(`   Verify on MikroTik:`);
      console.log(`   /ip hotspot user print where mac-address=${mac.toUpperCase()}`);
      console.log(`   /ip hotspot active print\n`);
    } else {
      console.error(`   ❌ FAILED: ${result.error}\n`);
    }
    return;
  }

  if (cmd === 'revoke' && mac) {
    console.log(`3️⃣  Revoking access for ${mac}...`);
    const result = await revokeAccess(mac);
    console.log(result.ok ? `   ✅ Revoked!` : `   ❌ FAILED: ${result.error}`);
    return;
  }

  console.log('✅ All tests passed! RouterOS API is working.\n');
  console.log('To test granting a MAC:');
  console.log('  node test-mikrotik-api.js grant AA:BB:CC:DD:EE:FF\n');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
