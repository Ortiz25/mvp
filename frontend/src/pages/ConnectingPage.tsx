import { useEffect, useRef, useState } from 'react';
import { usePortal } from '../context/SessionContext';

/**
 * ConnectingPage
 *
 * By the time we render this, the Pi backend has:
 *   1. Added MAC to /ip/hotspot/user
 *   2. Called /ip/hotspot/active/login — session is live at network layer
 *
 * The phone already HAS internet. The problem is purely signalling the OS.
 *
 * PATTERN (copied from working reference implementation):
 *   - Fire a background fetch() to http://192.168.88.1/login?username=...
 *     This is fire-and-forget. We don't await it. It either works (confirms
 *     the session) or gets intercepted — doesn't matter, the network is open.
 *   - After a short fixed delay, navigate to google.com via window.location.replace
 *   - The OS captive portal WebView sees a successful response from the real
 *     internet and dismisses permanently.
 *
 * WHY NOT AWAIT THE FETCH:
 *   The fetch to 192.168.88.1/login may time out, redirect, or be intercepted
 *   depending on whether the session activated. We don't care about its result —
 *   the active session was already created server-side. We just need to give the
 *   OS a moment and then send it to the internet.
 *
 * WHY 1500ms DELAY:
 *   RouterOS needs ~500ms to commit the active session after active/login returns.
 *   1.5 seconds gives comfortable headroom.
 */
export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const done = useRef(false);
  const [secs, setSecs] = useState(2);

  const mac     = hotspot.mac || status?.mac || null;
  const dst     = hotspot.dst || status?.dst || 'http://www.google.com';
  const loginUrl = mac
    ? `http://192.168.88.1/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent(mac)}&dst=${encodeURIComponent(dst)}`
    : null;

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    // Countdown display
    const tick = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);

    // Fire background fetch to MikroTik login — don't await, don't care about result
    // This mirrors the working pattern from the reference implementation
    if (loginUrl) {
      fetch(loginUrl, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    }

    // After delay, navigate the browser to google — OS detects real internet, WebView dismisses
    const t = setTimeout(() => {
      clearInterval(tick);
      window.location.replace(dst.startsWith('http') ? dst : 'http://www.google.com');
    }, 2000);

    return () => { clearTimeout(t); clearInterval(tick); };
  }, [loginUrl, dst]);

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 px-6 animate-fade-in">

      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua
          flex items-center justify-center">
          <svg className="w-7 h-7 text-void" fill="none" viewBox="0 0 24 24"
            stroke="currentColor" strokeWidth={2.5}>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path strokeLinecap="round" d="M7 11V7a5 5 0 0 1 9.9-1" />
          </svg>
        </div>
      </div>

      <div className="text-center">
        <p className="font-display font-bold text-white text-xl mb-1">You're Connected!</p>
        <p className="text-sm text-white/50 font-body">
          {secs > 0 ? `Opening browser in ${secs}…` : 'Opening your browser…'}
        </p>
      </div>

      <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />

      {/* Manual fallback */}
      <button
        onClick={() => window.location.replace(dst.startsWith('http') ? dst : 'http://www.google.com')}
        className="w-full py-4 rounded-xl font-display font-bold text-base
          bg-signal border border-signal/40 text-void
          hover:bg-signal/90 active:scale-95 transition-all duration-150">
        Start Browsing →
      </button>

      {mac && (
        <p className="text-[10px] text-white/15 font-mono text-center">{mac}</p>
      )}
    </div>
  );
}
