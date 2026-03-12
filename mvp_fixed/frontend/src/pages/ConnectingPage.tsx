/**
 * ConnectingPage — shown when:
 *  1. MikroTik bounces the browser back to captive.local after granting access
 *     (Android captive portal WebView behaviour), OR
 *  2. The browser can't follow the external redirect to google.com yet
 *
 * This is a DEDICATED ROUTE (/connecting) so it is never accidentally
 * navigated away from by other pages checking selectedSlug / status.
 *
 * The user sees "Access Granted" and a manual "Open Browser →" button.
 * We do NOT auto-redirect here — the WebView already tried and failed,
 * so another automatic redirect will just loop. Let the user tap.
 */

import { clearGrantedFlag } from '../App';
import { IconUnlock } from '../components/layout/Shell';

export function ConnectingPage() {
  const openBrowser = () => {
    clearGrantedFlag();
    window.location.replace('http://www.google.com');
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 animate-fade-in px-6">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div
          className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua
            flex items-center justify-center"
        >
          <IconUnlock className="w-7 h-7 text-void" />
        </div>
      </div>

      <div className="text-center">
        <p className="font-display font-bold text-white text-lg mb-1">Access Granted!</p>
        <p className="text-sm text-white/40 font-body mb-1">Your device is now authorized.</p>
        <p className="text-xs text-white/25 font-body">
          Tap the button below to start browsing.
        </p>
      </div>

      <button
        onClick={openBrowser}
        className="mt-2 px-8 py-4 rounded-xl font-display font-bold text-base
          bg-signal border border-signal/40 text-void
          hover:bg-signal/90 active:scale-95 transition-all duration-150"
      >
        Open Browser →
      </button>

      <p className="text-[10px] text-white/15 font-body text-center px-8 leading-relaxed">
        If the button doesn't work, open your browser and visit any website —
        you should now have internet access.
      </p>
    </div>
  );
}
