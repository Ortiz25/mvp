import { useEffect, useRef, useState } from 'react';
import { usePortal } from '../context/SessionContext';

/**
 * ConnectingPage — Final auth trigger.
 *
 * The Pi backend has already added the MAC to /ip/hotspot/user
 * and attempted /ip/hotspot/active/add.
 *
 * If active/add succeeded → the phone already has internet.
 *   We just navigate to google to signal the OS.
 *
 * If active/add failed → the session is NOT yet active.
 *   We must trigger mac auto-auth by navigating to an HTTP URL.
 *   With login-by=mac, RouterOS intercepts any HTTP request and
 *   auto-authenticates if the MAC is in /ip/hotspot/user.
 *
 * CRITICAL: Must use HTTP not HTTPS. RouterOS hotspot only intercepts
 * plain HTTP. HTTPS goes straight through (or fails if not authenticated).
 *
 * NAVIGATION STRATEGY:
 * 1. Navigate to http://192.168.88.1/login?username=MAC&password=MAC&dst=...
 *    This hits RouterOS's hotspot web server directly (walled garden allows it).
 *    RouterOS creates the active session and 302s to dst.
 *    OS captive portal detector sees internet → dismisses WebView.
 *
 * 2. If MAC is unavailable (shouldn't happen), navigate to http://www.google.com.
 *    RouterOS intercepts it (unauth client), checks MAC in user table,
 *    auto-authenticates, then forwards to google.
 */
export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const fired  = useRef(false);
  const [secs, setSecs] = useState(2);

  const mac = hotspot.mac || status?.mac || null;

  // Determine where to send the browser.
  // dst from MikroTik is usually generate_204 (filtered out by sanitizeDst),
  // so we default to google. Must be HTTP — HTTPS dst breaks MikroTik /login redirect.
  const safeDst = 'http://www.google.com';

  // The MikroTik HTTP login URL. Hitting this URL causes RouterOS to:
  // 1. Look up the MAC in /ip/hotspot/user
  // 2. Create an active session  
  // 3. 302 redirect to safeDst
  // 4. OS sees real internet → dismisses captive portal WebView permanently
  const loginUrl = mac
    ? `http://192.168.88.1/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent(mac)}&dst=${encodeURIComponent(safeDst)}`
    : safeDst;

  function navigate() {
    window.location.href = loginUrl;
  }

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const tick = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);

    const t = setTimeout(() => {
      clearInterval(tick);
      navigate();
    }, 2000);

    return () => { clearTimeout(t); clearInterval(tick); };
  }, []); // eslint-disable-line

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 px-6 animate-fade-in">

      {/* Success icon */}
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

      {/* Message */}
      <div className="text-center">
        <p className="font-display font-bold text-white text-xl mb-1">
          Access Granted!
        </p>
        <p className="text-sm text-white/50 font-body">
          {secs > 0 ? `Connecting in ${secs}…` : 'Opening your browser…'}
        </p>
      </div>

      {/* Spinner */}
      <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />

      {/* Manual button — in case auto-redirect is delayed */}
      <button
        onClick={navigate}
        className="w-full py-4 rounded-xl font-display font-bold text-base
          bg-signal border border-signal/40 text-void
          hover:bg-signal/90 active:scale-95 transition-all duration-150">
        Open Browser →
      </button>

      {/* Debug: show exactly what URL we'll navigate to */}
      <div className="text-center px-4 space-y-1">
        {mac && <p className="text-[10px] text-white/15 font-mono">{mac}</p>}
        <p className="text-[9px] text-white/10 font-mono break-all">→ {loginUrl}</p>
      </div>
    </div>
  );
}
