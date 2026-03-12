/**
 * ConnectingPage — shown after access is granted by the backend.
 *
 * WHAT HAPPENED BY THIS POINT:
 *   The Pi has called MikroTik API → added the phone's MAC to /ip/hotspot/user.
 *   RouterOS will auto-authenticate the phone within 1-2 seconds.
 *   The phone now HAS internet access — it just doesn't know it yet.
 *
 * WHY WE DON'T AUTO-REDIRECT:
 *   The phone is inside the Android/iOS captive portal WebView.
 *   This WebView:
 *     - Intercepts window.location changes and may loop back to captive.local
 *     - Has no address bar — the user cannot type a URL
 *     - Dismisses itself (opens the real browser) only when it detects
 *       internet connectivity OR when the user taps a native "Done" button
 *
 *   The correct UX is:
 *     1. Show "You're connected" clearly
 *     2. Tell the user to CLOSE this window / open their browser
 *     3. The OS will dismiss the captive portal WebView automatically
 *        once it re-checks connectivity (usually within 5-10 seconds)
 *
 * CONNECTIVITY RE-CHECK:
 *   We poll /generate_204 every 3 seconds. When it returns 204 (not the
 *   portal's 200), the OS has already detected internet — we can safely
 *   redirect to google.com.
 */

import { useEffect, useState } from 'react';
import { clearGrantedFlag } from '../App';
import { IconUnlock } from '../components/layout/Shell';

export function ConnectingPage() {
  const [internetDetected, setInternetDetected] = useState(false);
  const [pollCount, setPollCount]               = useState(0);

  // Poll for real internet connectivity.
  // When the OS gets a 204 from generate_204 (not our portal's redirect),
  // internet is confirmed and we can redirect.
  useEffect(() => {
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 60 seconds max polling

    const check = async () => {
      attempts++;
      setPollCount(attempts);
      try {
        // Fetch with no-store to bypass cache. If we get a 204, internet is live.
        // Our portal returns 200 for everything, so 204 = real internet.
        const res = await fetch('http://connectivitycheck.gstatic.com/generate_204', {
          cache: 'no-store',
          mode:  'no-cors', // cross-origin — we just check if it resolves
        });
        // In no-cors mode, a successful fetch (even opaque) means connectivity
        // because the DNS is no longer pointing to our Pi
        setInternetDetected(true);
        clearGrantedFlag(); // clear flag — user has internet now
        // Small delay then redirect so user sees the success state
        setTimeout(() => {
          window.location.replace('http://www.google.com');
        }, 1500);
        return true;
      } catch {
        // Still on captive portal — keep polling
        if (attempts < MAX_ATTEMPTS) {
          setTimeout(check, 3000);
        }
        return false;
      }
    };

    // Start first check after 2 seconds (give RouterOS time to auth the MAC)
    const t = setTimeout(check, 2000);
    return () => clearTimeout(t);
  }, []);

  const openBrowser = () => {
    // Don't clear the flag here — if the WebView bounces back, we want
    // to still show ConnectingPage not PickerPage.
    // Flag auto-expires when session ends.
    try {
      // Try to open google in a new tab — works in some WebViews
      window.open('http://www.google.com', '_blank');
    } catch {}
    // Also try replacing location — may work once MAC is authenticated
    setTimeout(() => {
      window.location.replace('http://www.google.com');
    }, 500);
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-5 animate-fade-in px-6">

      {/* Icon */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div className={`relative w-16 h-16 rounded-full flex items-center justify-center
          transition-all duration-700
          ${internetDetected
            ? 'bg-gradient-to-br from-signal to-aqua'
            : 'bg-gradient-to-br from-signal/70 to-aqua/70'}`}>
          <IconUnlock className="w-7 h-7 text-void" />
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        {internetDetected ? (
          <>
            <p className="font-display font-bold text-white text-xl mb-1">
              You're Online! 🎉
            </p>
            <p className="text-sm text-white/50 font-body">
              Redirecting you to Google…
            </p>
          </>
        ) : (
          <>
            <p className="font-display font-bold text-white text-xl mb-1">
              Access Granted!
            </p>
            <p className="text-sm text-white/50 font-body mb-1">
              Your device is now authorized.
            </p>
            <p className="text-xs text-white/30 font-body">
              Activating your connection…
            </p>
          </>
        )}
      </div>

      {/* Spinner or check */}
      {!internetDetected && (
        <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />
      )}

      {/* Instructions */}
      {!internetDetected && (
        <div className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-center">
          <p className="text-[11px] font-display font-bold text-white/40 uppercase tracking-wider mb-2">
            While we activate your access
          </p>
          <p className="text-sm text-white/60 font-body leading-relaxed">
            Close this window and open your browser,
            or tap the button below.
          </p>
          <p className="text-xs text-white/25 font-body mt-2">
            Internet activates within a few seconds.
          </p>
        </div>
      )}

      {/* Open browser button */}
      <button
        onClick={openBrowser}
        className="w-full py-4 rounded-xl font-display font-bold text-base
          bg-signal border border-signal/40 text-void
          hover:bg-signal/90 active:scale-95 transition-all duration-150"
      >
        {internetDetected ? 'Go to Google →' : 'Open Browser →'}
      </button>

      {/* Debug: poll counter — remove in production */}
      {!internetDetected && pollCount > 0 && (
        <p className="text-[9px] text-white/10 font-mono">
          connectivity check {pollCount}/20
        </p>
      )}
    </div>
  );
}
