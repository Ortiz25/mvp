import { useEffect, useRef } from 'react';
import { usePortal } from '../context/SessionContext';

/**
 * ConnectingPage — final step after access is granted.
 *
 * WHY WE GO THROUGH /login INSTEAD OF DIRECTLY TO A SITE:
 *
 *   active/login via the binary API creates the session entry in RouterOS,
 *   but the browser's traffic is only unblocked AFTER RouterOS confirms it
 *   via the HTTP /login servlet. Navigating directly to google.com means
 *   RouterOS intercepts the request, sees it as HTTP (or follows the HTTPS
 *   redirect), and serves alogin.html instead of passing it through.
 *
 *   The correct path:
 *     1. Browser → http://192.168.88.1/login?username=MAC&password=MAC&dst=ORIG
 *     2. RouterOS servlet finds the active session for this MAC
 *     3. RouterOS 302 → ORIG (must be a plain HTTP site, no HTTPS redirect)
 *     4. Browser follows to ORIG → real internet response
 *     5. OS captive portal detector sees real internet → dismisses WebView
 *
 *   dst=http://neverssl.com is ideal — it's a permanent plain-HTTP site
 *   with no redirect, designed exactly for this captive portal use case.
 *
 * BOUNCE-BACK HANDLING:
 *   If the WebView bounces back to captive.local after /connecting fires,
 *   the status route finds this MAC with access_granted=1 and active=true,
 *   so PickerPage's useEffect re-routes back to /connecting immediately.
 *   The user sees ConnectingPage again and can tap the button manually.
 */

const CONFIRM_URL = 'http://neverssl.com';   // plain HTTP, no HTTPS redirect, no captive interference
const ROUTER_IP   = '192.168.88.1';

export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const fired = useRef(false);

  const mac = hotspot.mac || status?.mac || null;

  // dst: use the original URL the user was trying to reach, or neverssl as fallback
  const dst = hotspot.dst || status?.dst || CONFIRM_URL;

  // The MikroTik HTTP login servlet URL — this is the authoritative confirmation path
  const loginUrl = mac
    ? `http://${ROUTER_IP}/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent(mac)}&dst=${encodeURIComponent(dst)}`
    : null;

  function goNow() {
    window.location.href = loginUrl || `http://${ROUTER_IP}/login`;
  }

  useEffect(() => {
    if (!loginUrl || fired.current) return;
    fired.current = true;

    // 1.5s delay: enough for RouterOS to propagate the active session to its
    // firewall rules after the binary API active/login call on the backend.
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
        <p className="text-sm text-white/50 font-body">
          {loginUrl ? 'Opening your browser…' : 'Access granted.'}
        </p>
      </div>

      <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />

      {/* Manual trigger — if auto-redirect stalls */}
      {loginUrl && (
        <button
          onClick={goNow}
          className="w-full py-4 rounded-xl font-display font-bold text-base
            bg-signal border border-signal/40 text-void
            hover:bg-signal/90 active:scale-95 transition-all duration-150">
          Start Browsing →
        </button>
      )}

      {!loginUrl && (
        <div className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-center">
          <p className="text-sm text-white/60 font-body">
            Close this window and open your browser — you're online.
          </p>
        </div>
      )}

      {/* Tiny debug info */}
      {mac && (
        <p className="text-[10px] text-white/15 font-mono text-center break-all px-4">{mac}</p>
      )}
    </div>
  );
}