import { useEffect, useRef, useState } from 'react';
import { usePortal } from '../context/SessionContext';

const ROUTER_IP = '192.168.88.1';
const PASS = 'password';
const FINAL_URL = 'http://neverssl.com';

export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const fired = useRef(false);
  const [countdown, setCountdown] = useState(3);

  // Resolve MAC — must be a string before we can use it
  const mac: string | null = hotspot?.mac || status?.mac || null;

  // Build login URL only when MAC is known
  const loginUrl = mac
    ? `http://${ROUTER_IP}/login?username=${encodeURIComponent(mac)}&password=${encodeURIComponent(PASS)}`
    : null;

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    // Fire-and-forget fetch — tells MikroTik to mark session active
    // Only fires if we have a MAC. If no MAC, RADIUS already accepted
    // the device so navigating to neverssl.com is enough.
    if (loginUrl) {
      fetch(loginUrl).catch(() => {});
    }

    // Countdown then navigate to plain HTTP — triggers OS connectivity
    // check and dismisses the captive portal WebView
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
  }, [loginUrl]);

  function goNow() {
    if (loginUrl) {
      fetch(loginUrl).catch(() => {});
    }
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