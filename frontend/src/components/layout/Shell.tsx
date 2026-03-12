import { useState, useEffect, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePortal } from '../../context/SessionContext';

// ── SVG Icon library ───────────────────────────────────────────────────────
type IconProps = { className?: string };
export const IconWifi      = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none"/></svg>;
export const IconPlay      = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/></svg>;
export const IconCheck     = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>;
export const IconGlobe     = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
export const IconGrid      = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
export const IconClipboard = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>;
export const IconLock      = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
export const IconUnlock    = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>;
export const IconBook      = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
export const IconClock     = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>;
export const IconArrow     = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>;
export const IconSignal    = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/></svg>;
export const IconExternalLink = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
export const IconZap       = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"/></svg>;
export const IconStar      = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2"/></svg>;
export const IconUsers     = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
export const IconHeartbeat = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>;
export const IconMapPin    = ({ className = 'w-5 h-5' }: IconProps) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;

// ── Portal step config ─────────────────────────────────────────────────────
const STEPS = [
  { path: '/',        label: 'Pick',   Icon: IconSignal },
  { path: '/watch',   label: 'Watch',  Icon: IconPlay },
  { path: '/survey',  label: 'Survey', Icon: IconClipboard },
  { path: '/connecting', label: 'Online', Icon: IconUnlock },
];

const TABS = [
  { path: '/',       label: 'Portal', Icon: IconWifi,  group: ['/', '/watch', '/survey', '/connecting'] },
  { path: '/offline',label: 'Apps',   Icon: IconGrid,  group: ['/offline'] },
];

// ── Countdown chip ─────────────────────────────────────────────────────────
function CountdownChip({ expiresAt }: { expiresAt: string }) {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      if (!diff) { setT('Expired'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setT(`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return (
    <span className="flex items-center gap-1 font-mono text-[11px] font-medium text-signal/70 tabular-nums">
      <IconClock className="w-3 h-3 opacity-60" />{t}
    </span>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────
export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate     = useNavigate();
  const { config, status } = usePortal();

  const stepIdx   = STEPS.findIndex(s => s.path === pathname);
  const showSteps = stepIdx >= 0 && pathname !== '/connecting';
  const isOnline  = !!(status?.accessGranted && status?.active);
  const campName  = config?.campaign?.name;

  return (
    <div className="min-h-screen flex items-center justify-center p-3 sm:p-5">
      {/* Atmosphere */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px]
          bg-signal/[0.06] rounded-full blur-[160px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px]
          bg-aqua/[0.03] rounded-full blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.018]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
      </div>

      <div className="relative w-full max-w-[420px]">
        {/* Online status banner */}
        {isOnline && (
          <div className="mb-2 mx-1 flex items-center justify-between
            bg-signal/[0.07] border border-signal/20 rounded-xl px-4 py-2 animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-signal animate-pulse-soft shrink-0" />
              <span className="text-[10px] font-display font-bold text-signal tracking-widest uppercase">
                Internet Active
              </span>
            </div>
            {status?.expiresAt && <CountdownChip expiresAt={status.expiresAt} />}
          </div>
        )}

        {/* Card */}
        <div className="bg-void/95 border border-white/[0.07] rounded-2xl shadow-lifted overflow-hidden backdrop-blur-xl">

          {/* Header */}
          <div className="px-5 pt-4 pb-3.5 border-b border-white/[0.05]
            bg-gradient-to-b from-white/[0.03] to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-signal to-aqua
                  flex items-center justify-center glow-signal shrink-0">
                  <IconWifi className="w-[18px] h-[18px] text-void" />
                </div>
                <div>
                  <p className="text-[9px] font-display font-bold tracking-[0.2em] uppercase text-signal/60 leading-none mb-0.5">
                    Free Wi-Fi
                  </p>
                  <h1 className="font-display font-bold text-[15px] text-white leading-none">
                    {campName ?? 'CityNet Hotspot'}
                  </h1>
                </div>
              </div>
              <div className="chip chip-live">
                <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse-soft" />
                LIVE
              </div>
            </div>
          </div>

          {/* Step indicator */}
          {showSteps && (
            <div className="px-5 py-3 border-b border-white/[0.04] bg-night/40">
              <div className="flex items-center">
                {STEPS.map((step, i) => {
                  const done = i < stepIdx, cur = i === stepIdx;
                  return (
                    <div key={step.path} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <div className={`step-node ${done ? 'step-done' : cur ? 'step-current' : 'step-future'}`}>
                          {done ? <IconCheck className="w-3 h-3" /> : <step.Icon className="w-3.5 h-3.5" />}
                        </div>
                        <span className={`text-[8px] font-display font-bold uppercase tracking-wider transition-colors duration-300
                          ${cur ? 'text-white/60' : done ? 'text-signal/50' : 'text-white/15'}`}>
                          {step.label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`h-px flex-1 mx-1.5 mb-4 rounded-full transition-all duration-500
                          ${i < stepIdx ? 'bg-gradient-to-r from-signal to-aqua' : 'bg-white/[0.08]'}`} />
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
            {TABS.map(({ path, label, Icon, group }) => {
              const active = group.includes(pathname);
              return (
                <button key={path} onClick={() => navigate(path)}
                  className={`tab-item ${active ? 'tab-item-active' : ''}`}>
                  <div className={`p-1.5 rounded-xl transition-all duration-200 ${active ? 'bg-signal/15' : ''}`}>
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-center text-[9px] text-white/10 font-body mt-3">
          Powered by CityNet · Free community internet access
        </p>
      </div>
    </div>
  );
}
