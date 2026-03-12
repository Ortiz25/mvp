import { useEffect, useRef, useState } from 'react';
import { usePortal } from '../context/SessionContext';

/**
 * ConnectingPage
 *
 * By the time the user reaches this page, the Pi has already:
 *   1. Added the MAC to /ip/hotspot/user
 *   2. Called /ip/hotspot/active/login to force-create an active session
 *
 * This means the phone already HAS internet at the network layer.
 * The only remaining problem is that the OS captive portal WebView doesn't
 * know this yet — it's waiting for a connectivity signal.
 *
 * HOW TO SIGNAL THE OS:
 *   Different OSes use different probes. We trigger all of them:
 *
 *   Android: navigates to connectivitycheck.gstatic.com/generate_204
 *     — expects HTTP 204. After we grant access, our nginx no longer
 *       intercepts this (MikroTik passes it through to google's servers).
 *       Google returns 204. Android sees it. WebView dismisses. ✓
 *
 *   iOS: navigates to captive.apple.com/hotspot-detect.html
 *     — expects "Success" in the body. Same mechanism.
 *
 *   The way to trigger the OS probe is to navigate the WebView to one of
 *   these URLs. We use a hidden <img> and an <a> tag approach.
 *
 * FALLBACK:
 *   If the active/login call fell back (no DHCP lease found), the session
 *   activates on the first packet from the client. Navigating to google.com
 *   or hitting the MikroTik /login URL will trigger this.
 *   We provide a "Start Browsing" button that hits 192.168.88.1/login as
 *   a fallback — this forces session activation even without active/login.
 */
export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const triggered = useRef(false);
  const [countdown, setCountdown] = useState(2);

  const mac = hotspot.mac || status?.mac || null;
  const dst = hotspot.dst || status?.dst || 'http://www.google.com';

  // MikroTik HTTP login URL — fallback if active/login didn't create session
  const loginUrl = mac
    ? `http://192.168.88.1/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent(mac)}&dst=${encodeURIComponent(dst)}`
    : null;

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;

    // Countdown then auto-navigate to trigger OS connectivity recheck
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          // Navigate to MikroTik login URL — two effects:
          //   1. If active session wasn't created, this triggers it
          //   2. MikroTik redirects browser to dst (google.com)
          //      OS detects real internet → WebView dismisses
          if (loginUrl) window.location.replace(loginUrl);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [loginUrl]);

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 px-6 animate-fade-in">

      {/* Animated unlock */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua
          flex items-center justify-center">
          <svg className="w-7 h-7 text-void" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path strokeLinecap="round" d="M7 11V7a5 5 0 0 1 9.9-1" />
          </svg>
        </div>
      </div>

      <div className="text-center">
        <p className="font-display font-bold text-white text-xl mb-1">You're Connected!</p>
        <p className="text-sm text-white/50 font-body">
          {countdown > 0 ? `Opening browser in ${countdown}…` : 'Opening browser…'}
        </p>
      </div>

      <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />

      {/* Manual button in case auto-redirect is slow */}
      {loginUrl && (
        <a href={loginUrl}
          className="w-full py-4 rounded-xl font-display font-bold text-base text-center
            bg-signal border border-signal/40 text-void
            hover:bg-signal/90 active:scale-95 transition-all duration-150 block mt-2">
          Start Browsing →
        </a>
      )}

      <p className="text-[10px] text-white/20 font-body text-center">
        Your device is now authorized.{'\n'}
        {mac && <span className="font-mono">{mac}</span>}
      </p>
    </div>
  );
}
