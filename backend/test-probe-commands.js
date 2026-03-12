#!/usr/bin/env node
/**
 * COMMAND PROBE — Run this on the Pi to discover available RouterOS commands.
 * 
 * Run: node backend/test-probe-commands.js
 * 
 * This tests several approaches to activating a hotspot session:
 *   A. /ip/hotspot/active/add    — direct add (may not exist)
 *   B. /ip/hotspot/active/login  — confirmed not available
 *   C. /ip/arp/add               — add ARP entry to help RouterOS find the MAC
 *   D. /ip/hotspot/cookie/add    — cookie-based auth (different mechanism)
 *   E. Check /ip/hotspot/host    — these are the layer2-visible clients
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const net = require('net');

const HOST = process.env.MIKROTIK_HOST     || '192.168.88.1';
const PORT = parseInt(process.env.MIKROTIK_API_PORT || '8728');
const USER = process.env.MIKROTIK_API_USER || 'pi-api';
const PASS = process.env.MIKROTIK_API_PASS || '';

function el(n){if(n<0x80)return Buffer.from([n]);if(n<0x4000)return Buffer.from([(n>>8)|0x80,n&0xFF]);if(n<0x200000)return Buffer.from([(n>>16)|0xC0,(n>>8)&0xFF,n&0xFF]);return Buffer.from([(n>>24)|0xE0,(n>>16)&0xFF,(n>>8)&0xFF,n&0xFF]);}
function ew(w){const b=Buffer.from(w,'utf8');return Buffer.concat([el(b.length),b]);}
function es(ws){return Buffer.concat([...ws.map(ew),Buffer.from([0])]);}
function decode(buf){const out=[],cur=[];let i=0;while(i<buf.length){const b0=buf[i];let len,skip;if((b0&0xE0)===0xE0){len=((b0&0x1F)<<24)|(buf[i+1]<<16)|(buf[i+2]<<8)|buf[i+3];skip=4;}else if((b0&0xC0)===0xC0){len=((b0&0x3F)<<16)|(buf[i+1]<<8)|buf[i+2];skip=3;}else if((b0&0x80)===0x80){len=((b0&0x7F)<<8)|buf[i+1];skip=2;}else{len=b0;skip=1;}i+=skip;if(len===0){if(cur.length){out.push([...cur]);cur.splice(0);}}else{cur.push(buf.slice(i,i+len).toString('utf8'));i+=len;}}return out;}

function run(cmds){return new Promise((resolve,reject)=>{
  const s=new net.Socket();let buf=Buffer.alloc(0),idx=0,login=false,results=[];
  const t=setTimeout(()=>{s.destroy();reject(new Error('timeout'));},8000);
  s.connect(PORT,HOST,()=>s.write(es(['/login',`=name=${USER}`,`=password=${PASS}`])));
  s.on('data',chunk=>{
    buf=Buffer.concat([buf,chunk]);
    for(const words of decode(buf)){
      if(!login){if(words[0]==='!done'){login=true;s.write(es(cmds[0]));}}
      else{if(!results[idx])results[idx]=[];results[idx].push(words);if(words[0]==='!done'||words[0]==='!trap'){idx++;if(idx<cmds.length)s.write(es(cmds[idx]));else{clearTimeout(t);s.end();resolve(results);}}}
    }
    buf=Buffer.alloc(0);
  });
  s.on('error',e=>{clearTimeout(t);reject(e);});
  s.on('close',()=>{clearTimeout(t);resolve(results);});
});}

function fmt(rows) {
  return rows.filter(w=>w[0]==='!re').map(w=>w.slice(1).join(' | ')).join('\n  ') || '(none)';
}
function trap(rows) {
  const t = rows.find(w=>w[0]==='!trap');
  return t ? `TRAP: ${t.slice(1).join(' ')}` : 'OK (no trap)';
}

async function main(){
  console.log(`\n🔬 RouterOS Command Probe — ${HOST}:${PORT}\n`);

  // Test one command at a time to avoid connection issues
  async function test(label, cmd) {
    try {
      const r = await run([cmd]);
      const rows = r[0] || [];
      const t = rows.find(w=>w[0]==='!trap');
      if (t) {
        const msg = t.slice(1).join(' ').replace(/=message=?/,'');
        console.log(`❌ ${label}: TRAP "${msg}"`);
        return false;
      }
      const re = rows.filter(w=>w[0]==='!re');
      console.log(`✅ ${label}: OK (${re.length} rows)`);
      if (re.length > 0) re.slice(0,3).forEach(w => console.log(`   ${w.slice(1).join(' | ')}`));
      return true;
    } catch(e) {
      console.log(`💥 ${label}: ERROR ${e.message}`);
      return false;
    }
  }

  // Current state
  console.log('── Current State ──────────────────────────────');
  await test('hotspot/user list',     ['/ip/hotspot/user/print']);
  await test('hotspot/active list',   ['/ip/hotspot/active/print']);
  await test('hotspot/host list',     ['/ip/hotspot/host/print']);
  await test('dhcp leases (raw)',     ['/ip/dhcp-server/lease/print']);
  await test('arp table',             ['/ip/arp/print']);

  console.log('\n── Session Creation Attempts ──────────────────');
  // Try active/add (different from active/login)
  await test('hotspot/active/add',    ['/ip/hotspot/active/add',
    '=server=hotspot1','=user=TEST','=address=192.168.88.99','=mac-address=AA:BB:CC:DD:EE:FF']);
  
  // Try changing user profile to see if that helps  
  await test('hotspot/user/set bypass',['/ip/hotspot/user/add',
    '=name=BYPASS-TEST','=mac-address=AA:BB:CC:DD:EE:FF','=profile=default']);

  // Check what profile=default has
  await test('user-profile print',    ['/ip/hotspot/user-profile/print']);

  // Check hotspot server settings  
  await test('hotspot server print',  ['/ip/hotspot/print']);

  // Check walled garden
  await test('walled-garden',         ['/ip/hotspot/walled-garden/print']);
  
  // Cleanup test entries
  await run([['/ip/hotspot/user/print','?name=BYPASS-TEST']]).then(async r=>{
    const ids=(r[0]||[]).filter(w=>w[0]==='!re').flatMap(w=>w.slice(1)).filter(w=>w.startsWith('=.id=')).map(w=>w.slice(5));
    for(const id of ids) await run([['/ip/hotspot/user/remove',`=.id=${id}`]]).catch(()=>{});
  }).catch(()=>{});

  console.log('\n── Key Questions Answered ─────────────────────');
  console.log('Check /ip/hotspot/host — if phone appears there, it IS visible to RouterOS');
  console.log('If hotspot/active/add works, we can create sessions directly without /login');
  console.log('If user-profile shows session-timeout, that may be killing sessions');
}

main().catch(e=>{ console.error('FATAL:', e.message); process.exit(1); });
