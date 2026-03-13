import { useEffect, useRef } from 'react';
import { usePortal } from '../context/SessionContext';

/**
 * ConnectingPage — final step after RADIUS grant.
 *
 * RADIUS has already written the MAC to radcheck/radreply on the server.
 * MikroTik will Accept this MAC on its next RADIUS check.
 *
 * We navigate the browser to:
 *   http://192.168.88.1/login?username=MAC&password=password&dst=http://neverssl.com
 *
 * MikroTik's servlet receives this, triggers a RADIUS auth for the MAC,
 * gets Access-Accept, marks the session active, and 302s to neverssl.com.
 * neverssl.com is plain HTTP with no redirect — ideal for captive portal
 * detection. The OS sees real internet and dismisses the WebView.
 *
 * WHY neverssl.com and not google.com:
 *   google.com immediately 301 → https://google.com.
 *   MikroTik intercepts the HTTPS request, serves alogin.html, loop.
 *   neverssl.com stays HTTP, no redirect, OS detector sees 200 → done.
 *
 * PASSWORD is the static string "password" — this matches what FreeRADIUS
 * has in radcheck (Cleartext-Password = "password"). It is not a user
 * password — it is a shared secret used purely for MAC authentication.
 */

const ROUTER_IP   = '192.168.88.1';
const RADIUS_PASS = 'password';       // matches radcheck Cleartext-Password
const CONFIRM_DST = 'http://neverssl.com';

export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const fired = useRef(false);

  const mac = hotspot.mac || status?.mac || null;

  // Replace your loginUrl construction with this:
const dst = 'http://neverssl.com';

const loginUrl = mac
  ? `http://192.168.88.1/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent(PASS)}&dst=${encodeURIComponent(dst)}`
  : dst;
  function goNow() {
    window.location.href = loginUrl;
  }

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // 1.5s delay — lets user see the "Connected" screen + gives RADIUS time
    // to propagate the new radcheck row before MikroTik queries it
    const t = setTimeout(() => {
      window.location.replace(loginUrl);
    }, 1500);
    return () => clearTimeout(t);
  }, [loginUrl]);

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 px-6 animate-fade-in">

      {/* Animated success icon */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua
          flex items-center justify-center">
          <svg className="w-7 h-7 text-void" fill="none" viewBox="0 0 24 24"
            stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>

      <div className="text-center">
        <p className="font-display font-bold text-white text-xl mb-1">You're Connected!</p>
        <p className="text-sm text-white/50 font-body">Opening your browser…</p>
      </div>

      <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />

      <button
        onClick={goNow}
        className="w-full py-4 rounded-xl font-display font-bold text-base
          bg-signal border border-signal/40 text-void
          hover:bg-signal/90 active:scale-95 transition-all duration-150">
        Start Browsing →
      </button>

      {mac && (
        <p className="text-[10px] text-white/15 font-mono text-center break-all px-4">{mac}</p>
      )}
    </div>
  );
}
