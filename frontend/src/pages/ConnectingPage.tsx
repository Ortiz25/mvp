import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { calcTimeLeft, IconArrow, IconGrid, IconGlobe, IconBook } from '../components/layout/Shell';

const OFFLINE_APPS = [
  { name: 'Wikipedia', desc: 'Offline encyclopedia', url: 'http://kiwix.lan',   Icon: IconGlobe },
  { name: 'Kolibri',   desc: 'Learning platform',    url: 'http://kolibri.lan', Icon: IconBook  },
];

export function ConnectingPage() {
  const { status, config, refresh, selectedSlug, resolving } = usePortal();
  const navigate      = useNavigate();
  const loggedinFired = useRef(false);
  const refreshFired  = useRef(false);

  const sessionHours = config?.campaign?.sessionHours ?? 1;
  const expiresAt = status?.expiresAt ?? (
    status?.accessGranted
      ? new Date(Date.now() + sessionHours * 3600 * 1000).toISOString()
      : null
  );

  const [showApps, setShowApps] = useState(false);
  const [tl, setTl] = useState<ReturnType<typeof calcTimeLeft> | null>(null);

  // Sync tl when expiresAt first becomes available after async status load
  useEffect(() => {
    if (expiresAt && !tl) setTl(calcTimeLeft(expiresAt, sessionHours));
  }, [expiresAt, sessionHours]);

  // ── Bootstrap: ensure status is loaded ────────────────────────────────
  // When a user navigates directly to /connecting (e.g. types 192.168.182.1
  // in the browser after getting internet), status may be null because
  // refresh() was never called. Wait for whoAmI to finish resolving, then
  // call refresh() so we get expiresAt and can show the countdown.
  useEffect(() => {
    if (refreshFired.current) return;
    if (resolving) return; // wait for whoAmI to finish first
    if (!selectedSlug) return; // no slug yet — whoAmI still running or new user
    if (status) return; // already have status, no need to fetch

    refreshFired.current = true;
    console.log('[ConnectingPage] Fetching status for slug:', selectedSlug);
    refresh();
  }, [selectedSlug, resolving, status]);

  // ── Fire CoovaChilli loggedin once ────────────────────────────────────
  useEffect(() => {
    if (loggedinFired.current) return;
    loggedinFired.current = true;
    setTimeout(() => {
      fetch('http://192.168.182.1:3990/loggedin', {
        mode: 'no-cors', cache: 'no-cache',
      }).catch(() => {});
    }, 800);
  }, []);

  // ── Live countdown ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!expiresAt) return;
    setTl(calcTimeLeft(expiresAt, sessionHours));
    const id = setInterval(() => {
      const next = calcTimeLeft(expiresAt, sessionHours);
      setTl(next);
      if (next.expired) navigate('/', { replace: true });
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, sessionHours]);

  // ── Redirect if not authenticated ──────────────────────────────────────
  useEffect(() => {
    if (resolving) return;
    if (!status) return;
    if (!status.accessGranted && !status.active) navigate('/', { replace: true });
  }, [resolving, status]);

  const fmt2 = (n: number) => String(n).padStart(2, '0');

  // Show loading spinner while resolving whoAmI or fetching status
  const stillLoading = resolving || (!status && !selectedSlug);

  return (
    <div className="flex flex-col px-5 py-6 gap-5 animate-fade-up">

      {/* ── Connected hero ── */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow"/>
          <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua flex items-center justify-center shadow-lg">
            {stillLoading ? (
              <div className="w-6 h-6 rounded-full border-2 border-void/40 border-t-void animate-spin"/>
            ) : (
              <svg className="w-7 h-7 text-void" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            )}
          </div>
        </div>
        <div className="text-center">
          <p className="font-display font-extrabold text-white text-xl mb-0.5">
            {stillLoading ? 'Checking session…' : "You're Online!"}
          </p>
          <p className="text-xs text-white/40 font-body">
            {config?.campaign?.name ?? 'CityNet'} · free internet access
          </p>
        </div>
      </div>

      {/* ── Time remaining card ── */}
      {!stillLoading && tl && expiresAt && (
        <div className={`rounded-xl border px-5 py-4 transition-colors duration-700
          ${tl.urgent && !tl.expired
            ? 'bg-red-500/[0.07] border-red-500/20'
            : 'bg-signal/[0.06] border-signal/20'}`}>

          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-white/40">
              Session Time Remaining
            </p>
            <span className={`text-[9px] font-display font-bold uppercase tracking-wider
              ${tl.expired ? 'text-white/20' : tl.urgent ? 'text-red-400' : 'text-signal/70'}`}>
              {tl.expired ? 'Expired' : tl.urgent ? '⚠ Expiring soon' : 'Active'}
            </span>
          </div>

          {/* Big countdown */}
          <div className={`font-mono text-4xl font-bold tabular-nums text-center mb-3 transition-colors duration-700
            ${tl.expired ? 'text-white/20' : tl.urgent ? 'text-red-400' : 'text-white'}`}>
            {tl.h > 0 && `${tl.h}:`}{fmt2(tl.m)}:{fmt2(tl.s)}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000
                ${tl.expired ? 'bg-white/10' : tl.urgent ? 'bg-red-400' : 'bg-gradient-to-r from-signal to-aqua'}`}
              style={{ width: `${Math.round(tl.pct * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-white/25 font-body text-center mt-2">
            {tl.expired
              ? 'Your session has ended'
              : `${Math.ceil(tl.totalMs / 60000)} min of ${sessionHours * 60} min remaining`}
          </p>
        </div>
      )}

      {/* No expiry info — chilli fallback session (no DB record) */}
      {!stillLoading && !expiresAt && status?.accessGranted && (
        <div className="rounded-xl border border-signal/20 bg-signal/[0.06] px-5 py-4 text-center">
          <p className="text-[11px] text-white/40 font-body">
            Session active · expiry time not available
          </p>
        </div>
      )}

      {/* ── Offline apps toggle ── */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <button
          onClick={() => setShowApps(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3.5
            bg-white/[0.02] hover:bg-white/[0.04] transition-colors duration-150 active:bg-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-signal/10 border border-signal/20 flex items-center justify-center">
              <IconGrid className="w-3.5 h-3.5 text-signal"/>
            </div>
            <div className="text-left">
              <p className="text-[12px] font-display font-bold text-white leading-none">Offline Apps</p>
              <p className="text-[9px] text-white/30 font-body mt-0.5">Available without internet</p>
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-white/25 transition-transform duration-200 ${showApps ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="6,9 12,15 18,9"/>
          </svg>
        </button>

        {showApps && (
          <div className="border-t border-white/[0.05] bg-white/[0.01] p-3 space-y-2">
            {OFFLINE_APPS.map(({ name, desc, url, Icon }) => (
              <a key={name} href={url}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.07]
                  bg-white/[0.03] hover:bg-white/[0.06] active:bg-white/[0.08]
                  transition-colors duration-150 group no-underline">
                <div className="w-8 h-8 rounded-lg bg-signal/10 border border-signal/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-signal"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-display font-bold text-white leading-none">{name}</p>
                  <p className="text-[10px] text-white/30 font-body mt-0.5">{desc}</p>
                </div>
                <IconArrow className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 transition-colors shrink-0"/>
              </a>
            ))}
            <button
              onClick={() => navigate('/offline')}
              className="w-full text-center text-[10px] text-signal/60 font-display font-bold
                uppercase tracking-wider py-2 hover:text-signal transition-colors">
              View all apps →
            </button>
          </div>
        )}
      </div>

      {/* ── Browse now ── */}
      <a
        href="https://google.com"
        className="w-full py-4 rounded-xl font-display font-bold text-base text-center
          bg-gradient-to-r from-signal to-aqua text-void shadow-md
          active:scale-[0.98] transition-transform duration-150 no-underline block">
        Start Browsing →
      </a>

    </div>
  );
}