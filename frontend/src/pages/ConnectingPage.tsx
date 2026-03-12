import { useEffect, useRef } from 'react';
import { usePortal } from '../context/SessionContext';

/**
 * ConnectingPage — the final step. Triggers MikroTik HTTP login.
 *
 * HOW MIKROTIK MAC-AUTH + HTTP LOGIN WORKS TOGETHER:
 *
 *   login-by=mac means RouterOS authenticates clients BY LOOKING UP their
 *   MAC in /ip/hotspot/user automatically. The Pi already added the MAC via
 *   the binary API. So the user IS already authorised at the network layer.
 *
 *   BUT the browser/OS doesn't know this yet. The captive portal WebView
 *   only dismisses when it makes a successful HTTP request to the internet
 *   (a real 204 from google, or a redirect to an external URL).
 *
 *   The way to trigger this is to send the browser to:
 *     http://192.168.88.1/login?username=MAC&password=MAC&dst=ORIG
 *
 *   RouterOS receives this GET request from the client, finds the MAC in
 *   /ip/hotspot/user, marks the SESSION as active (separate from user auth),
 *   and redirects the browser to ORIG (or google.com if dst is absent).
 *
 *   Now the browser is talking to the real internet. The OS captive portal
 *   detector sees this and permanently dismisses the WebView.
 *
 * WHY NOT JUST WINDOW.LOCATION.REPLACE('http://google.com')?
 *   Because the client's traffic is still blocked at network layer until
 *   RouterOS marks the session active via the /login endpoint. The browser
 *   would just get a connection error or be redirected back to captive.local.
 *
 * THIS PAGE:
 *   Auto-redirects to the MikroTik /login URL after a short delay.
 *   If MAC is not available (shouldn't happen in production), shows a
 *   manual instruction instead.
 */
export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const redirected = useRef(false);

  // Build the MikroTik HTTP login URL
  const mac = hotspot.mac || status?.mac || null;
  const dst = hotspot.dst || status?.dst || 'http://www.google.com';

  const loginUrl = mac
    ? `http://192.168.88.1/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent(mac)}&dst=${encodeURIComponent(dst)}`
    : null;

  useEffect(() => {
    if (!loginUrl || redirected.current) return;
    redirected.current = true;

    // Short delay — gives the user a moment to see the "connected" screen
    // and ensures RouterOS has fully committed the hotspot user entry
    const t = setTimeout(() => {
      window.location.replace(loginUrl);
    }, 1500);

    return () => clearTimeout(t);
  }, [loginUrl]);

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 px-6 animate-fade-in">

      {/* Animated unlock icon */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua
          flex items-center justify-center">
          <svg className="w-7 h-7 text-void" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 11V7a4 4 0 118 0v4M5 11h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2z" />
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

      {/* Fallback if auto-redirect doesn't fire */}
      {loginUrl && (
        <a href={loginUrl}
          className="w-full py-4 rounded-xl font-display font-bold text-base text-center
            bg-signal border border-signal/40 text-void
            hover:bg-signal/90 active:scale-95 transition-all duration-150 block">
          Start Browsing →
        </a>
      )}

      {!loginUrl && (
        <div className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-center">
          <p className="text-sm text-white/60 font-body">
            Close this window and open your browser — you're online.
          </p>
        </div>
      )}
    </div>
  );
}
