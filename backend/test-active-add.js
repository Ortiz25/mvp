#!/usr/bin/env node
/**
 * TEST active/add parameters — run while phone is connected to WiFi
 * 
 * The probe showed active/add exists but "server" is wrong param.
 * This script tries different parameter combinations.
 * 
 * Usage: node backend/test-active-add.js
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
function decode(buf){const out=[],cur=[];let i=0;while(i<buf.length){const b0=buf[i];let len,skip;if((b0&0xE0)===0xE0){len=((b0&0x1F)<<24)|(buf[i+1]<<16)|(buf[i+2]<<8)|buf[i+3];skip=4;}else if((b0&0xC0)===0xC0){len=((b0&0x3F)<<16)|(buf[i+1]<<8)|buf[i+2];skip=3;}else if((b0&0x80)===0x80){len=((b0&0x7F)<<8)|buf[i+1];skip=2;}else{len=b0;skip=1;}i+=skip;if(len===0){if(cur.length){out.push([...cur]);cur.splice(0);}}else{out[out.length-1]===cur&&out.push(cur);cur.push(buf.slice(i,i+len).toString('utf8'));i+=len;}}return out;}

// Simpler decode
function decode2(buf) {
  const sentences = []; let words = [], i = 0;
  while (i < buf.length) {
    const b0 = buf[i]; let len, skip;
    if      ((b0&0xE0)===0xE0) { len=((b0&0x1F)<<24)|(buf[i+1]<<16)|(buf[i+2]<<8)|buf[i+3]; skip=4; }
    else if ((b0&0xC0)===0xC0) { len=((b0&0x3F)<<16)|(buf[i+1]<<8)|buf[i+2]; skip=3; }
    else if ((b0&0x80)===0x80) { len=((b0&0x7F)<<8)|buf[i+1]; skip=2; }
    else                        { len=b0; skip=1; }
    i += skip;
    if (len === 0) { if (words.length) { sentences.push(words); words = []; } }
    else           { words.push(buf.slice(i, i+len).toString('utf8')); i += len; }
  }
  return sentences;
}

function runOne(cmd) {
  return new Promise((resolve) => {
    const s = new net.Socket(); let buf = Buffer.alloc(0), login = false, result = [];
    const t = setTimeout(() => { s.destroy(); resolve([{type:'!trap',attrs:{message:'timeout'}}]); }, 6000);
    s.connect(PORT, HOST, () => s.write(es(['/login', `=name=${USER}`, `=password=${PASS}`])));
    s.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (const words of decode2(buf)) {
        const type = words[0] || '';
        const attrs = {};
        for (const w of words.slice(1)) { const eq = w.indexOf('='); if (eq > 0) attrs[w.slice(1,eq)] = w.slice(eq+1); }
        if (!login) {
          if (type === '!done') { login = true; s.write(es(cmd)); }
        } else {
          result.push({ type, attrs, raw: words });
          if (type === '!done' || type === '!trap') { clearTimeout(t); s.end(); resolve(result); }
        }
      }
      buf = Buffer.alloc(0);
    });
    s.on('error', () => { clearTimeout(t); resolve([{type:'!trap',attrs:{message:'conn error'}}]); });
    s.on('close', () => { clearTimeout(t); resolve(result); });
  });
}

function fmt(result) {
  const trap = result.find(r => r.type === '!trap');
  if (trap) return `❌ TRAP: ${JSON.stringify(trap.attrs)}`;
  const re = result.filter(r => r.type === '!re');
  if (re.length) return `✅ OK: ${re.map(r=>r.raw.slice(1).join(' ')).join(' | ')}`;
  return `✅ OK (done, no data)`;
}

async function main() {
  const MAC = '8E:5A:E7:2C:58:52';  // current phone MAC
  const IP  = '192.168.88.3';        // current phone IP

  console.log(`\n🔬 active/add Parameter Discovery`);
  console.log(`   Phone: MAC=${MAC}  IP=${IP}\n`);

  // First: get current state
  console.log('Current state:');
  const hosts = await runOne(['/ip/hotspot/host/print']);
  hosts.filter(r=>r.type==='!re').forEach(r => {
    const m = r.attrs['mac-address'], auth = r.attrs['authorized'];
    if (m) console.log(`  host: ${m}  authorized=${auth}  ip=${r.attrs['address']}`);
  });

  const active = await runOne(['/ip/hotspot/active/print']);
  console.log(`  active sessions: ${active.filter(r=>r.type==='!re').length}`);
  
  // Ensure user entry exists
  console.log('\nEnsuring user entry for phone MAC...');
  const findOld = await runOne(['/ip/hotspot/user/print', `?mac-address=${MAC}`]);
  for (const r of findOld.filter(x=>x.type==='!re')) {
    if (r.attrs['.id']) {
      await runOne(['/ip/hotspot/user/remove', `=.id=${r.attrs['.id']}`]);
      console.log(`  Removed old: ${r.attrs['.id']}`);
    }
  }
  await runOne(['/ip/hotspot/user/add', `=name=${MAC}`, `=mac-address=${MAC}`, '=profile=default', '=limit-uptime=01:00:00']);
  console.log(`  Added user entry for ${MAC}`);

  // Now try active/add with different parameter sets
  console.log('\n── Testing /ip/hotspot/active/add params ──\n');

  // From RouterOS docs: active table has: server, user, address, mac-address, login-by
  const attempts = [
    // Minimal
    ['/ip/hotspot/active/add', `=address=${IP}`, `=mac-address=${MAC}`],
    // With user
    ['/ip/hotspot/active/add', `=address=${IP}`, `=mac-address=${MAC}`, `=user=${MAC}`],
    // With uptime
    ['/ip/hotspot/active/add', `=address=${IP}`, `=mac-address=${MAC}`, `=user=${MAC}`, '=uptime=0s'],
    // With login-by
    ['/ip/hotspot/active/add', `=address=${IP}`, `=mac-address=${MAC}`, `=user=${MAC}`, '=login-by=mac'],
    // server as name not param
    ['/ip/hotspot/active/add', `=address=${IP}`, `=mac-address=${MAC}`, `=user=${MAC}`, '=server=hotspot1', '=login-by=mac'],
    // to-address
    ['/ip/hotspot/active/add', `=to-address=${IP}`, `=mac-address=${MAC}`, `=user=${MAC}`],
  ];

  for (const [i, cmd] of attempts.entries()) {
    const params = cmd.slice(1).join(' ');
    const r = await runOne(cmd);
    console.log(`Attempt ${i+1}: ${params}`);
    console.log(`  → ${fmt(r)}`);

    // If it worked, check active list
    const trap = r.find(x=>x.type==='!trap');
    if (!trap) {
      console.log('  🎉 SUCCESS! Checking active sessions...');
      await new Promise(resolve => setTimeout(resolve, 500));
      const check = await runOne(['/ip/hotspot/active/print']);
      check.filter(x=>x.type==='!re').forEach(x =>
        console.log(`  Session: ${x.raw.slice(1).join(' | ')}`)
      );
      // Clean up and stop
      const sess = check.filter(x=>x.type==='!re' && x.attrs['mac-address']?.toUpperCase()===MAC.toUpperCase());
      for (const s of sess) {
        if (s.attrs['.id']) await runOne(['/ip/hotspot/active/remove', `=.id=${s.attrs['.id']}`]);
      }
      console.log(`\n✅ WINNING COMMAND: ${cmd.join(' ')}`);
      return;
    }
    console.log('');
  }

  console.log('\n── All active/add attempts failed ──');
  console.log('active/add is not usable for creating sessions on this RouterOS build.');
  console.log('\nFallback approach: rely on mac auto-auth via browser redirect.');
  console.log('The phone needs to make a real HTTP request (window.location.href)');
  console.log('to any HTTP URL after grant. RouterOS intercepts it, sees MAC in user');  
  console.log('table, auto-authenticates, creates session, redirects to dst.');
  console.log('\nCheck: does window.location.href actually navigate in the captive WebView?');
  console.log('Test: open http://neverssl.com or http://example.com from ConnectingPage.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
