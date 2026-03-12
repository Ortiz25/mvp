#!/usr/bin/env node
/**
 * LIVE GRANT TEST — run this while phone is connected to the hotspot WiFi
 * 
 * Usage:
 *   node backend/test-live-grant.js
 *
 * It will:
 *  1. List all current DHCP leases (shows connected phones)
 *  2. List any active hotspot sessions
 *  3. Ask you to pick the MAC to grant
 *  4. Run the full grant sequence and show exactly what RouterOS returns
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const net = require('net');

const HOST = process.env.MIKROTIK_HOST     || '192.168.88.1';
const PORT = parseInt(process.env.MIKROTIK_API_PORT || '8728', 10);
const USER = process.env.MIKROTIK_API_USER || 'pi-api';
const PASS = process.env.MIKROTIK_API_PASS || '';
const HS   = process.env.MIKROTIK_HOTSPOT  || 'hotspot1';

// ── Binary API ──
function el(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([(len>>8)|0x80, len&0xFF]);
  if (len < 0x200000) return Buffer.from([(len>>16)|0xC0,(len>>8)&0xFF,len&0xFF]);
  return Buffer.from([(len>>24)|0xE0,(len>>16)&0xFF,(len>>8)&0xFF,len&0xFF]);
}
function ew(w) { const b=Buffer.from(w,'utf8'); return Buffer.concat([el(b.length),b]); }
function es(words) { return Buffer.concat([...words.map(ew), Buffer.from([0])]); }
function decode(buf) {
  const sentences=[]; let cur=[],i=0;
  while(i<buf.length){
    const b0=buf[i]; let len,skip;
    if((b0&0xE0)===0xE0){len=((b0&0x1F)<<24)|(buf[i+1]<<16)|(buf[i+2]<<8)|buf[i+3];skip=4;}
    else if((b0&0xC0)===0xC0){len=((b0&0x3F)<<16)|(buf[i+1]<<8)|buf[i+2];skip=3;}
    else if((b0&0x80)===0x80){len=((b0&0x7F)<<8)|buf[i+1];skip=2;}
    else{len=b0;skip=1;}
    i+=skip;
    if(len===0){if(cur.length){sentences.push(cur);cur=[];}}
    else{cur.push(buf.slice(i,i+len).toString('utf8'));i+=len;}
  }
  return sentences;
}
function parse(words) {
  const type=words[0]||''; const attrs={};
  for(const w of words.slice(1)){const eq=w.indexOf('=');if(eq>0)attrs[w.slice(1,eq)]=w.slice(eq+1);}
  return {type,attrs};
}
function run(cmds) {
  return new Promise((resolve,reject)=>{
    const s=new net.Socket(); let buf=Buffer.alloc(0),idx=0,login=false,results=[];
    const t=setTimeout(()=>{s.destroy();reject(new Error('timeout 10s'));},10000);
    s.connect(PORT,HOST,()=>s.write(es(['/login',`=name=${USER}`,`=password=${PASS}`])));
    s.on('data',chunk=>{
      buf=Buffer.concat([buf,chunk]);
      for(const words of decode(buf)){
        const p=parse(words);
        if(!login){
          if(p.type==='!done'){login=true;s.write(es(cmds[0]));}
          else if(p.type==='!trap'){clearTimeout(t);s.destroy();reject(new Error('Login failed: '+JSON.stringify(p.attrs)));}
        } else {
          if(!results[idx])results[idx]=[];
          results[idx].push(p);
          if(p.type==='!done'||p.type==='!trap'){
            idx++;
            if(idx<cmds.length)s.write(es(cmds[idx]));
            else{clearTimeout(t);s.end();resolve(results);}
          }
        }
      }
      buf=Buffer.alloc(0);
    });
    s.on('error',e=>{clearTimeout(t);reject(e);});
    s.on('close',()=>{clearTimeout(t);if(idx>=cmds.length)resolve(results);else reject(new Error('closed early'));});
  });
}
function getRe(r,i){return(r[i]||[]).filter(x=>x.type==='!re').map(x=>x.attrs);}
function getTrap(r,i){return(r[i]||[]).find(x=>x.type==='!trap')?.attrs||null;}

async function main(){
  console.log(`\n📡 Live Grant Test — ${HOST}:${PORT} user=${USER} hotspot=${HS}\n`);

  // Step 1: Get all live info
  const r1 = await run([
    ['/system/identity/print'],
    ['/ip/dhcp-server/lease/print'],
    ['/ip/hotspot/active/print'],
    ['/ip/hotspot/user/print'],
    ['/user/print'],   // check pi-api group
  ]);

  const identity = getRe(r1,0)[0];
  console.log('🏷  Router:', identity?.name || JSON.stringify(identity));

  const leases = getRe(r1,1);
  console.log(`\n📋 DHCP Leases (${leases.length}):`);
  if(leases.length===0) console.log('   (none — phone not connected or not in DHCP pool)');
  leases.forEach(l=>console.log(`   ${l['mac-address']}  ${l.address}  status=${l.status}  host=${l['host-name']||'?'}`));

  const active = getRe(r1,2);
  console.log(`\n🟢 Active Hotspot Sessions (${active.length}):`);
  if(active.length===0) console.log('   (none)');
  active.forEach(a=>console.log(`   ${a['mac-address']}  ${a.address}  user=${a.user}  uptime=${a.uptime}`));

  const users = getRe(r1,3);
  console.log(`\n👤 Hotspot Users (${users.length}):`);
  users.slice(0,5).forEach(u=>console.log(`   ${u['mac-address']||u.name}  profile=${u.profile}  uptime=${u['limit-uptime']}`));

  const apiUsers = getRe(r1,4);
  const piApi = apiUsers.find(u=>u.name==='pi-api');
  console.log(`\n🔑 pi-api user: group=${piApi?.group||'NOT FOUND'}`);
  if(piApi?.group !== 'full') {
    console.log('   ⚠️  pi-api is NOT in "full" group — active/login may be blocked');
    console.log('   Fix: /user set pi-api group=full');
  }

  // Step 2: Find the phone MAC
  const phoneLease = leases.find(l =>
    l.address && l.address !== '192.168.88.1' && l.address !== '192.168.88.2' &&
    l.status !== 'waiting'
  );

  if(!phoneLease) {
    console.log('\n❌ No phone found in DHCP leases.');
    console.log('   → Connect phone to WiFi first, then re-run this script.');

    // Still test active/login with hardcoded values to check permission
    console.log('\n🧪 Testing active/login permission with dummy values...');
    const r2 = await run([[
      '/ip/hotspot/active/login',
      '=ip=192.168.88.100',
      '=mac-address=AA:BB:CC:DD:EE:FF',
      '=user=AA:BB:CC:DD:EE:FF',
      '=password=',
      `=server=${HS}`,
    ]]);
    const trap2 = getTrap(r2,0);
    const done2 = r2[0]?.find(x=>x.type==='!done');
    console.log('   Raw result:', JSON.stringify(r2[0]));
    if(trap2) console.log(`   ❌ TRAP: ${JSON.stringify(trap2)}`);
    else if(done2) console.log('   ✅ Command accepted (no trap) — permissions OK');
    return;
  }

  const mac = phoneLease['mac-address'];
  const ip  = phoneLease.address;
  console.log(`\n📱 Found phone: MAC=${mac}  IP=${ip}\n`);

  // Step 3: Remove any old user entry
  const findOld = await run([['/ip/hotspot/user/print', `?mac-address=${mac}`]]);
  for(const u of getRe(findOld,0)) {
    if(u['.id']) {
      await run([['/ip/hotspot/user/remove', `=.id=${u['.id']}`]]);
      console.log(`Removed old user entry ${u['.id']}`);
    }
  }

  // Step 4: Add user
  const addRes = await run([[
    '/ip/hotspot/user/add',
    `=name=${mac}`, `=mac-address=${mac}`,
    '=profile=default', '=limit-uptime=01:00:00',
    '=comment=LiveTest',
  ]]);
  const addTrap = getTrap(addRes,0);
  if(addTrap) { console.log(`❌ user/add failed: ${JSON.stringify(addTrap)}`); return; }
  console.log(`✅ user/add OK`);

  // Step 5: active/login
  console.log(`\n🔓 Calling active/login ip=${ip} mac=${mac} server=${HS}...`);
  const loginRes = await run([[
    '/ip/hotspot/active/login',
    `=ip=${ip}`,
    `=mac-address=${mac}`,
    `=user=${mac}`,
    '=password=',
    `=server=${HS}`,
  ]]);
  const loginTrap = getTrap(loginRes,0);
  const loginRaw  = loginRes[0];
  console.log('   Raw reply:', JSON.stringify(loginRaw));

  if(loginTrap) {
    console.log(`\n❌ active/login TRAP: ${JSON.stringify(loginTrap)}`);
    console.log('   → This is the blocker. See FIXES below.');
    console.log('\n══════════════════════════════════════════════');
    console.log('POSSIBLE FIXES TO TRY ON ROUTEROS:');
    console.log('1. Give pi-api full rights:');
    console.log('      /user set pi-api group=full');
    console.log('2. Try login via HTTP instead (run on router):');
    console.log(`      /ip/hotspot/active/login ip=${ip} mac-address=${mac} user=${mac} server=${HS}`);
    console.log('3. Check if command exists:');
    console.log('      :put [/ip hotspot active login ...]');
    console.log('══════════════════════════════════════════════');
  } else {
    console.log(`\n✅ active/login succeeded!`);

    // Verify
    await new Promise(r=>setTimeout(r,600));
    const verify = await run([['/ip/hotspot/active/print']]);
    const sessions = getRe(verify,0);
    console.log(`\n Active sessions now: ${sessions.length}`);
    sessions.forEach(a=>console.log(`   ${a['mac-address']}  ${a.address}  user=${a.user}`));

    const found = sessions.find(a=>(a['mac-address']||'').toUpperCase()===mac.toUpperCase());
    if(found) console.log('\n🎉 Session verified! Phone should have internet now.');
    else console.log('\n⚠️  active/login returned done but session not in active list — strange.');
  }
}

main().catch(e=>{ console.error('\nFATAL:', e.message); process.exit(1); });
