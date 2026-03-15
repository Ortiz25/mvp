import { useEffect, useRef, useState } from 'react';
import { usePortal } from '../context/SessionContext';

// After auth, navigate to Google's connectivity check URL.
// This returns a real 204 from Google's servers (since iptables
// now allows this MAC through), which tells the OS internet is
// available and updates the Wi-Fi icon.
const FINAL_URL = 'http://connectivitycheck.gstatic.com/generate_204';

export function ConnectingPage() {
  const { hotspot, status } = usePortal();
  const fired = useRef(false);
  const [countdown, setCountdown] = useState(3);
  const mac: string | null = hotspot?.mac || status?.mac || null;

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const interval = setInterval(() => {
      setCountdown(c => c - 1);
    }, 1000);

    const timer = setTimeout(() => {
      clearInterval(interval);
      // Navigate to Google's connectivity check — returns real 204
      // which dismisses the captive portal WebView and updates Wi-Fi icon.
      // The OS then knows internet is available.
      window.location.replace(FINAL_URL);
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  function goNow() {
    window.location.replace(FINAL_URL);
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
          {countdown > 0 ? `Opening browser in ${countdown}s...` : 'Connecting...'}
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