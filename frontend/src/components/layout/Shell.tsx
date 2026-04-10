import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePortal } from '../../context/SessionContext';
import { portalApi } from '../../lib/api';

type IconProps = { className?: string };
export const IconWifi         = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none"/></svg>;
export const IconPlay         = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/></svg>;
export const IconCheck        = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>;
export const IconGlobe        = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
export const IconGrid         = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
export const IconClipboard    = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>;
export const IconLock         = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
export const IconUnlock       = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>;
export const IconBook         = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
export const IconClock        = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>;
export const IconArrow        = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>;
export const IconSignal       = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/></svg>;
export const IconExternalLink = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
export const IconZap          = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"/></svg>;
export const IconStar         = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2"/></svg>;
export const IconUsers        = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
export const IconHeartbeat    = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>;
export const IconMapPin       = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;

// ── Steps ──────────────────────────────────────────────────────────────────
const STEPS = [
  { path: '/',           label: 'Pick',   Icon: IconSignal  },
  { path: '/watch',      label: 'Watch',  Icon: IconPlay    },
  { path: '/survey',     label: 'Survey', Icon: IconClipboard },
  { path: '/connecting', label: 'Online', Icon: IconUnlock  },
];

// ── Time helpers ───────────────────────────────────────────────────────────
function fmt2(n: number) { return String(n).padStart(2, '0'); }

export interface TimeLeft {
  totalMs: number; h: number; m: number; s: number;
  pct: number; urgent: boolean; expired: boolean;
}

export function calcTimeLeft(expiresAt: string, sessionHours: number): TimeLeft {
  const TEN_MIN   = 10 * 60 * 1000;
  const totalMs   = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const sessionMs = sessionHours * 3600 * 1000;
  return {
    totalMs,
    h: Math.floor(totalMs / 3600000),
    m: Math.floor((totalMs % 3600000) / 60000),
    s: Math.floor((totalMs % 60000) / 1000),
    pct:     sessionMs > 0 ? Math.min(1, totalMs / sessionMs) : 0,
    urgent:  totalMs > 0 && totalMs < TEN_MIN,
    expired: totalMs === 0,
  };
}

// ── Session Timer Banner (exported for ConnectingPage) ─────────────────────
export function SessionTimerBanner({
  expiresAt,
  sessionHours,
}: {
  expiresAt: string;
  sessionHours: number;
}) {
  const [tl, setTl] = useState<TimeLeft>(() => calcTimeLeft(expiresAt, sessionHours));
  useEffect(() => {
    const id = setInterval(() => setTl(calcTimeLeft(expiresAt, sessionHours)), 1000);
    return () => clearInterval(id);
  }, [expiresAt, sessionHours]);

  const R   = 44;
  const C   = 2 * Math.PI * R;
  const off = tl.expired ? C : C * (1 - tl.pct);

  const ringCol  = tl.expired ? 'text-white/10' : tl.urgent ? 'text-red-400' : tl.pct > 0.25 ? 'text-signal' : 'text-amber-400';
  const labelCol = tl.expired ? 'text-white/20'  : tl.urgent ? 'text-red-400' : 'text-signal';
  const timeStr  = tl.expired ? 'Expired' : `${tl.h}:${fmt2(tl.m)}:${fmt2(tl.s)}`;
  const sub      = tl.expired ? 'Your session has ended' : tl.urgent ? 'Less than 10 min left' : `${Math.ceil(tl.totalMs / 60000)} min remaining`;
  const bg       = tl.urgent && !tl.expired ? 'bg-red-500/[0.07] border-red-500/20' : 'bg-signal/[0.07] border-signal/20';

  return (
    <div className={`mb-2 mx-1 animate-fade-in rounded-xl border px-4 py-2.5 transition-colors duration-700 ${bg}`}>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0 w-10 h-10">
          <svg viewBox="0 0 100 100" className={`w-10 h-10 -rotate-90 transition-colors duration-700 ${ringCol}`}>
            <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="8" opacity={0.12}/>
            <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="8"
              strokeDasharray={C} strokeDashoffset={off} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }}/>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {tl.expired
              ? <IconLock className="w-3.5 h-3.5 text-white/20"/>
              : <IconWifi className={`w-3.5 h-3.5 transition-colors duration-700 ${tl.urgent ? 'text-red-400' : 'text-signal'}`}/>}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-mono text-[15px] font-bold tabular-nums leading-none mb-0.5 transition-colors duration-700 ${labelCol}`}>{timeStr}</div>
          <div className="text-[9px] font-display font-bold uppercase tracking-[0.15em] text-white/30 leading-none">{sub}</div>
        </div>
        <div className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-display font-bold uppercase tracking-widest border transition-colors duration-700
          ${tl.expired ? 'bg-white/[0.03] border-white/10 text-white/20' : tl.urgent ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-signal/10 border-signal/20 text-signal'}`}>
          {!tl.expired && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tl.urgent ? 'bg-red-400' : 'bg-signal animate-pulse-soft'}`}/>}
          {tl.expired ? 'Offline' : 'Online'}
        </div>
      </div>
    </div>
  );
}

// ── Connection chip ────────────────────────────────────────────────────────
function ConnectionChip({ isOnline, urgent }: { isOnline: boolean; urgent?: boolean }) {
  if (isOnline) return (
    <div className={`chip transition-colors duration-500 ${urgent ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'chip-live'}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgent ? 'bg-red-400' : 'bg-signal animate-pulse-soft'}`}/>
      {urgent ? 'EXPIRING' : 'ONLINE'}
    </div>
  );
  return (
    <div className="chip bg-white/[0.04] border border-white/[0.08] text-white/30">
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-white/20"/>
      OFFLINE
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────
export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate     = useNavigate();
  const { config, status, hotspot, selectedSlug } = usePortal();

  const campName     = config?.campaign?.name;
  const sessionHours = config?.campaign?.sessionHours ?? 1;

  // ── Online detection ─────────────────────────────────────────────────────
  // The Google favicon probe ALWAYS resolves in no-cors mode — even when
  // chilli has the client in dnat (blocked) state — because chilli returns
  // a redirect response which fetch() treats as a success.
  //
  // The only reliable source of truth is the backend /status endpoint, which
  // reads chilli_query and returns accessGranted=true only after the UAM
  // logon has been processed and chilli has moved the session to 'pass'.
  //
  // Strategy: poll /status every 10s. If accessGranted && active → ONLINE.
  // This is the same data the portal pages use, but polled continuously so
  // the chip updates without requiring a page navigation.
  const [isOnline, setIsOnline] = useState(
    !!(status?.accessGranted && status?.active)
  );

  // Keep hotspot in a ref so pollStatus can read it without being
  // recreated on every render (avoids the interval-restart flood).
  const hotspotRef = useRef(hotspot);
  useEffect(() => { hotspotRef.current = hotspot; }, [hotspot]);

  // Poll status independently in Shell so the chip stays live on every page.
  // IMPORTANT: only depend on selectedSlug (stable string), not hotspot object.
  // hotspot is read via ref at call time so the interval never restarts just
  // because the hotspot reference changed.
  const pollStatus = useCallback(async () => {
    const slug = selectedSlug;
    if (!slug) return;
    try {
      const s = await portalApi.status(slug, hotspotRef.current);
      setIsOnline(!!(s.accessGranted && s.active));
    } catch {
      // network error — keep last known state
    }
  }, [selectedSlug]); // intentionally NOT including hotspot — using ref

  // Sync immediately when status changes via refresh() in pages
  useEffect(() => {
    setIsOnline(!!(status?.accessGranted && status?.active));
  }, [status?.accessGranted, status?.active]);

  // Background poll every 10s — interval is stable because pollStatus is stable
  useEffect(() => {
    if (!selectedSlug) return;
    pollStatus();
    const id = setInterval(pollStatus, 10_000);
    return () => clearInterval(id);
  }, [selectedSlug, pollStatus]);

  const TEN_MIN = 10 * 60 * 1000;
  const urgent  = !!(isOnline && status?.expiresAt &&
    (new Date(status.expiresAt).getTime() - Date.now()) < TEN_MIN);

  // ── Auto-redirect online users to status page ────────────────────────────
  // Once the chip flips to ONLINE, send users away from pre-auth pages to
  // /connecting (which acts as the "You're Online" status screen).
  const PRE_AUTH = ['/', '/watch', '/survey'];
  useEffect(() => {
    if (isOnline && PRE_AUTH.includes(pathname)) {
      navigate('/connecting', { replace: true });
    }
  }, [isOnline, pathname]);

  const stepIdx   = STEPS.findIndex(s => s.path === pathname);
  const showSteps = stepIdx >= 0 && pathname !== '/connecting';

  // Portal tab → /connecting when online, / when offline
  const portalDest  = isOnline ? '/connecting' : '/';
  const portalGroup = ['/', '/watch', '/survey', '/connecting'];

  return (
    <div className="min-h-screen flex items-center justify-center p-3 sm:p-5">
      {/* Atmosphere */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-signal/[0.06] rounded-full blur-[160px]"/>
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-aqua/[0.03] rounded-full blur-[120px]"/>
        <div className="absolute inset-0 opacity-[0.018]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}/>
      </div>

      <div className="relative w-full max-w-[420px]">

        {/* Timer banner above card */}
        {isOnline && status?.expiresAt && (
          <SessionTimerBanner expiresAt={status.expiresAt} sessionHours={sessionHours}/>
        )}

        <div className="bg-void/95 border border-white/[0.07] rounded-2xl shadow-lifted overflow-hidden backdrop-blur-xl">

          {/* Header */}
          <div className="px-5 pt-4 pb-3.5 border-b border-white/[0.05] bg-gradient-to-b from-white/[0.03] to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-signal to-aqua flex items-center justify-center glow-signal shrink-0">
                  <IconWifi className="w-[18px] h-[18px] text-void"/>
                </div>
                <div>
                  <p className="text-[9px] font-display font-bold tracking-[0.2em] uppercase text-signal/60 leading-none mb-0.5">Free Wi-Fi</p>
                  <h1 className="font-display font-bold text-[15px] text-white leading-none">{campName ?? 'CityNet Hotspot'}</h1>
                </div>
              </div>
              <ConnectionChip isOnline={isOnline} urgent={urgent}/>
            </div>
          </div>

          {/* Step indicator */}
          {showSteps && (
            <div className="px-5 py-3 border-b border-white/[0.04] bg-night/40">
              <div className="flex items-center">
                {STEPS.map((step, i) => {
                  const done = i < stepIdx;
                  const cur  = i === stepIdx;
                  return (
                    <div key={step.path} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <div className={`step-node ${done ? 'step-done' : cur ? 'step-current' : 'step-future'}`}>
                          {done ? <IconCheck className="w-3 h-3"/> : <step.Icon className="w-3.5 h-3.5"/>}
                        </div>
                        <span className={`text-[8px] font-display font-bold uppercase tracking-wider transition-colors duration-300
                          ${cur ? 'text-white/60' : done ? 'text-signal/50' : 'text-white/15'}`}>
                          {step.label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`h-px flex-1 mx-1.5 mb-4 rounded-full transition-all duration-500
                          ${i < stepIdx ? 'bg-gradient-to-r from-signal to-aqua' : 'bg-white/[0.08]'}`}/>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="min-h-[400px]">{children}</div>

          {/* Tab bar */}
          <div className="tab-bar">
            <button onClick={() => navigate(portalDest)}
              className={`tab-item ${portalGroup.includes(pathname) ? 'tab-item-active' : ''}`}>
              <div className={`p-1.5 rounded-xl transition-all duration-200 ${portalGroup.includes(pathname) ? 'bg-signal/15' : ''}`}>
                <IconWifi className="w-[18px] h-[18px]"/>
              </div>
              <span>{isOnline ? 'Status' : 'Portal'}</span>
            </button>
            <button onClick={() => navigate('/offline')}
              className={`tab-item ${pathname === '/offline' ? 'tab-item-active' : ''}`}>
              <div className={`p-1.5 rounded-xl transition-all duration-200 ${pathname === '/offline' ? 'bg-signal/15' : ''}`}>
                <IconGrid className="w-[18px] h-[18px]"/>
              </div>
              <span>Apps</span>
            </button>
          </div>

        </div>

        <p className="text-center text-[9px] text-white/10 font-body mt-3">
          Powered by CityNet · Free community internet access
        </p>
      </div>
    </div>
  );
}