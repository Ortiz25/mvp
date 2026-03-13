import { useEffect, useRef, useState } from 'react';
import { usePortal } from '../context/SessionContext';

const ROUTER_IP = '192.168.88.1';
const PASS = 'password';
const FINAL_URL = 'http://neverssl.com';

export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const fired = useRef(false);
  const [countdown, setCountdown] = useState(3);
  const mac = hotspot?.mac || status?.mac || null;

  useEffect(() => {
    if (fired.current || !mac) return;
    fired.current = true;

    // Step 1 — fire-and-forget fetch to MikroTik login servlet
    // This tells MikroTik to mark the session active immediately.
    // We do NOT navigate here — just fetch silently in background.
    const loginUrl = `http://${ROUTER_IP}/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent("password")}`;
    fetch(loginUrl).catch(() => {});

    // Step 2 — countdown then navigate to plain HTTP site
    // neverssl.com triggers the OS connectivity check which dismisses the WebView
    const interval = setInterval(() => {
      setCountdown(c => c - 1);
    }, 1000);

    const timer = setTimeout(() => {
      clearInterval(interval);
      window.location.replace(FINAL_URL);
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [mac]);

  function goNow() {
    fetch(
      `http://${ROUTER_IP}/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent("password")}`
    ).catch(() => {});
    setTimeout(() => {
      window.location.replace(FINAL_URL);
    }, 500);
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 px-6">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua flex items-center justify-center">
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
          {countdown > 0 ? `Opening browser in ${countdown}s...` : 'Opening browser...'}
        </p>
      </div>

      <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />

      <button
        onClick={goNow}
        className="w-full py-4 rounded-xl font-display font-bold text-base bg-signal border border-signal/40 text-void"
      >
        Start Browsing →
      </button>
    </div>
  );
}