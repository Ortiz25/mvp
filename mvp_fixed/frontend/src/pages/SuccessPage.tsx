import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import {
  IconUnlock, IconClock, IconBook, IconGlobe,
  IconMapPin, IconHeartbeat, IconZap, IconArrow, IconExternalLink
} from '../components/layout/Shell';

// ── Countdown timer ───────────────────────────────────────────────────────
function useCountdown(expiresAt: string | null) {
  const [t, setT] = useState('--:--:--');
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const diff = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      if (!diff) { setT('Expired'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setT(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return t;
}

// ── When is this page shown? ──────────────────────────────────────────────
//
//  MOCK mode (MIKROTIK_MOCK=true):
//    After video+survey, SurveyPage/VideoPage calls grantAccess(), gets mock=true,
//    and navigates here (navigate('/success')). This is the normal dev/test flow.
//
//  LIVE mode (MIKROTIK_MOCK=false):
//    Browser is redirected to MikroTik Hotspot login URL. MikroTik authenticates
//    the MAC and redirects to the original dst URL. User leaves captive.local.
//    They WON'T normally see this page in live mode.
//
//    This page CAN appear in live mode if:
//      - User navigates back to captive.local after already being granted
//      - MikroTik is configured with login-page pointing here after grant
//      - SUCCESS_REDIRECT is set to http://captive.local/success

const LOCAL_RESOURCES = [
  { name: 'Kolibri',         desc: 'Offline learning',  url: 'http://kolibri.local', Icon: IconBook,      color: 'border-violet-500/25 bg-violet-500/[0.06] text-violet-300' },
  { name: 'Wikipedia',       desc: 'Offline via Kiwix', url: 'http://kiwix.local',   Icon: IconGlobe,     color: 'border-sky-500/25 bg-sky-500/[0.06] text-sky-300' },
  { name: 'Community Board', desc: 'Local notices',     url: '#',                    Icon: IconMapPin,    color: 'border-amber-500/25 bg-amber-500/[0.06] text-amber-300' },
  { name: 'Health Info',     desc: 'Local resources',   url: '#',                    Icon: IconHeartbeat, color: 'border-signal/25 bg-signal/[0.06] text-signal' },
];

export function SuccessPage() {
  const navigate  = useNavigate();
  const { status, config, hotspot } = usePortal();
  const countdown = useCountdown(status?.expiresAt ?? null);
  const [entered, setEntered] = useState(false);

  const hours = status?.sessionHours ?? config?.campaign?.sessionHours ?? 8;

  // dst: prefer the stored session dst, then the hotspot param from sessionStorage
  const dst = status?.dst ?? hotspot.dst ?? null;

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 80);
    return () => clearTimeout(t);
  }, []);

  // In dev/mock mode we stay here so the dev can see the success UI.
  // In live mode we auto-redirect to dst after a short delay if present.
  // This handles the edge case where MikroTik sends the user back here.
  useEffect(() => {
    if (!dst) return;
    // Only auto-redirect in live mode (i.e. we actually have a dst URL from a real MikroTik redirect).
    // In mock mode, dst is null by default (no MikroTik redirect happened).
    const t = setTimeout(() => { window.location.href = dst; }, 5000);
    return () => clearTimeout(t);
  }, [dst]);

  return (
    <div className="px-5 py-6">
      {/* Unlock badge + headline */}
      <div className={`flex flex-col items-center text-center mb-5
        transition-all duration-700
        ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="relative flex items-center justify-center mb-4">
          <div className="absolute w-20 h-20 rounded-full border border-signal/20 animate-ping-slow" />
          <div className="absolute w-28 h-28 rounded-full border border-signal/10 animate-ping-slow"
            style={{ animationDelay: '400ms' }} />
          <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua
            flex items-center justify-center glow-signal animate-pop">
            <IconUnlock className="w-7 h-7 text-void" />
          </div>
        </div>
        <h2 className="font-display font-extrabold text-[24px] text-white tracking-tight mb-1">
          You're Online!
        </h2>
        <p className="text-[13px] text-white/40 font-body">
          Internet access granted for{' '}
          <span className="text-signal font-semibold">{hours} hours</span>
        </p>

        {/* Auto-redirect notice (live mode only, when dst is present) */}
        {dst && (
          <div className="mt-3 px-4 py-2.5 rounded-xl bg-signal/[0.07] border border-signal/20 text-center">
            <p className="text-[11px] text-signal/70 font-body mb-1">
              Redirecting you to your destination in 5 seconds…
            </p>
            <a href={dst}
              className="text-[10px] text-signal/40 underline underline-offset-2 hover:text-signal/60">
              Go now
            </a>
          </div>
        )}
      </div>

      {/* Countdown timer */}
      <div className={`mb-4 transition-all duration-500 delay-200
        ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="bg-signal/[0.06] border border-signal/20 rounded-2xl px-4 py-3.5
          flex items-center justify-between">
          <div>
            <p className="text-[9px] font-display font-bold uppercase tracking-[0.15em] text-white/25 mb-0.5">
              Session expires in
            </p>
            <span className="font-mono text-[22px] font-medium text-signal tabular-nums leading-none">
              {countdown}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-signal/10 border border-signal/20
            flex items-center justify-center">
            <IconClock className="w-5 h-5 text-signal/70" />
          </div>
        </div>
      </div>

      {/* Local resources */}
      <div className={`mb-5 transition-all duration-500 delay-300
        ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[9px] font-display font-bold uppercase tracking-[0.15em] text-white/20">
            Also available offline
          </p>
          <button onClick={() => navigate('/offline')}
            className="text-[9px] font-display font-bold text-signal/50 uppercase tracking-wider
              hover:text-signal transition-colors flex items-center gap-1">
            View all <IconArrow className="w-3 h-3" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {LOCAL_RESOURCES.map(({ name, desc, url, Icon, color }) => (
            <a key={name} href={url}
              className={`border rounded-xl p-3 flex items-start gap-2.5 no-underline
                transition-all duration-150 hover:brightness-125 active:scale-[0.97] group
                ${color}`}>
              <div className="w-7 h-7 rounded-lg bg-current/10 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-display font-bold text-white leading-tight">{name}</p>
                <p className="text-[9px] text-white/30 font-body leading-tight">{desc}</p>
              </div>
              <IconExternalLink className="w-3 h-3 ml-auto mt-0.5 opacity-0 group-hover:opacity-40
                transition-opacity shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Browse CTA */}
      <div className={`transition-all duration-500 delay-[450ms]
        ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <a href="http://www.google.com"
          className="btn-primary flex items-center justify-center gap-2.5 no-underline">
          <IconZap className="w-4 h-4" />
          <span>Start Browsing</span>
          <IconArrow className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
