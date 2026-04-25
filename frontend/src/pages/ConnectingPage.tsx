import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { calcTimeLeft, IconArrow, IconGrid, IconGlobe, IconBook } from '../components/layout/Shell';

// How long to show the "Session expired" grace screen before clearing state.
// During this window, page reloads still show the grace screen.
// After it ends, chilli will have disconnected the client from WiFi and
// the phone's native browser captive-portal detection handles reconnect.
const EXPIRED_GRACE_MS = 5 * 60 * 1000; // 5 minutes

const OFFLINE_APPS = [
  { name: 'Wikipedia', desc: 'Offline encyclopedia', url: 'http://kiwix.lan',   Icon: IconGlobe },
  { name: 'Kolibri',   desc: 'Learning platform',    url: 'http://kolibri.lan', Icon: IconBook  },
];

// ── Grace period helpers (persisted in sessionStorage so reloads survive) ───

function graceKey(mac: string) { return `expired_grace_until_${mac}`; }

function setGracePeriod(mac: string) {
  try { sessionStorage.setItem(graceKey(mac), String(Date.now() + EXPIRED_GRACE_MS)); } catch {}
}

function getGraceRemaining(mac: string): number {
  try {
    const until = parseInt(sessionStorage.getItem(graceKey(mac)) ?? '0', 10);
    return Math.max(0, until - Date.now());
  } catch { return 0; }
}

function clearGrace(mac: string) {
  try { sessionStorage.removeItem(graceKey(mac)); } catch {}
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

async function notifyChilliLoggedin() {
  try { await fetch('http://192.168.182.1:3990/loggedin', { mode: 'no-cors', cache: 'no-cache' }); } catch {}
}


const fmt2 = (n: number) => String(n).padStart(2, '0');
const fmtGrace = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${fmt2(s % 60)}`; };

// ── Component ────────────────────────────────────────────────────────────────

type Phase = 'loading' | 'active' | 'grace' | 'error';

export function ConnectingPage() {
  const { status, config, refresh, selectedSlug, resolving, loading, setStatus } = usePortal();
  const navigate      = useNavigate();
  const loggedinFired = useRef(false);
  const refreshFired  = useRef(false);

  const sessionHours = config?.campaign?.sessionHours ?? 1;
  const mac = status?.mac ?? '';
  const expiresAt = status?.expiresAt ?? (
    status?.accessGranted ? new Date(Date.now() + sessionHours * 3600 * 1000).toISOString() : null
  );

  const [phase,             setPhase]             = useState<Phase>('loading');
  const [tl,                setTl]                = useState<ReturnType<typeof calcTimeLeft> | null>(null);
  const [graceMs,           setGraceMs]           = useState(0);
  const [showApps,          setShowApps]          = useState(false);
  // internetConfirmed: true when the backend confirms accessGranted+active.
  // We trust the backend — chilli_query authorize is authoritative.
  // No client-side network probe needed; probes fail on Chrome Android due to
  // Private Network Access / mixed-content restrictions on captive portal pages.
  const [internetConfirmed, setInternetConfirmed] = useState(false);
  const [probing,           setProbing]           = useState(false);
  const [probeFailed,       setProbeFailed]       = useState(false);
  const probeRan = useRef(false);

  // Bootstrap: fetch session once on mount
  useEffect(() => {
    if (refreshFired.current || resolving || !selectedSlug) return;
    refreshFired.current = true;
    refresh();
  }, [selectedSlug, resolving]);

  // Notify chilli UAM once (best-effort)
  useEffect(() => {
    if (loggedinFired.current) return;
    loggedinFired.current = true;
    setTimeout(notifyChilliLoggedin, 600);
  }, []);

  // When the backend confirms active=true, trust it immediately.
  // chilli_query authorize is authoritative — no client-side network probe.
  // Probes via fetch() fail on Chrome Android on captive portal pages due to
  // Private Network Access restrictions, causing false "not online" results.
  useEffect(() => {

    const id = setInterval(() => {
      if (phase === 'active' && status?.active && status?.accessGranted) {
        setInternetConfirmed(true);
        setProbing(false);
        setProbeFailed(false);
      }
    }, 5000);
    return () => clearInterval(id);
   
  }, [phase, status]);

  // Restore grace period on reload — if sessionStorage has a pending grace
  // expiry for this MAC, jump straight to grace screen
  useEffect(() => {
    if (!mac) return;
    const remaining = getGraceRemaining(mac);
    if (remaining > 0) {
      setPhase('grace');
      setGraceMs(remaining);
    }
  }, [mac]);

  // Derive phase from session status
  useEffect(() => {
    if (resolving || !refreshFired.current) return;
    if (phase === 'grace') return; // never override grace with a status poll
    if (loading) { setPhase('loading'); return; }
    if (!status)  { setPhase('loading'); return; }
    if (status.active) { setPhase('active'); return; }
    if (!status.accessGranted) { setPhase('error'); return; }
    // accessGranted=true but active=false — expired while tab was backgrounded
    if (mac) setGracePeriod(mac);
    setGraceMs(EXPIRED_GRACE_MS);
    setPhase('grace');
  }, [resolving, loading, status, phase]);

  // Session countdown (only while active)
  useEffect(() => {
    if (!expiresAt || phase !== 'active') return;
    setTl(calcTimeLeft(expiresAt, sessionHours));
    const id = setInterval(() => {
      const next = calcTimeLeft(expiresAt, sessionHours);
      setTl(next);
      if (next.expired) {
        clearInterval(id);
        if (mac) setGracePeriod(mac);
        setGraceMs(EXPIRED_GRACE_MS);
        setPhase('grace');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, sessionHours, phase]);

  // Grace period countdown
  useEffect(() => {
    if (phase !== 'grace' || graceMs <= 0) return;
    const id = setInterval(() => {
      setGraceMs(prev => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(id);
          if (mac) clearGrace(mac);
          setStatus(null);
          navigate('/', { replace: true, state: { sessionExpired: true } });
          return 0;
        }
        // Keep sessionStorage fresh so reloads get accurate countdown
        if (mac) {
          try { sessionStorage.setItem(graceKey(mac), String(Date.now() + next)); } catch {}
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, graceMs, mac]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-16 gap-4 animate-fade-up">
        <div className="w-12 h-12 rounded-full border-2 border-signal/30 border-t-signal animate-spin"/>
        <p className="text-white/40 text-sm font-body">Checking session…</p>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="flex flex-col px-5 py-10 gap-5 items-center animate-fade-up">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
        </div>
        <div className="text-center">
          <h2 className="font-display font-extrabold text-white text-lg mb-1">Access Not Granted</h2>
          <p className="text-sm text-white/40 font-body max-w-xs">
            The Wi-Fi gateway didn't open your connection. Please try again.
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full">
          <button onClick={() => { setPhase('loading'); refreshFired.current = false; refresh(); }}
            className="btn-primary flex items-center justify-center gap-2">↺ Retry</button>
          <button onClick={() => { setStatus(null); navigate('/', { replace: true }); }}
            className="btn btn-surface w-full justify-center py-2.5">← Back to Campaigns</button>
        </div>
      </div>
    );
  }

  // ── Grace (session expired, waiting for chilli to disconnect client) ───────
  if (phase === 'grace') {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-10 gap-6 animate-fade-up min-h-[60vh]">
        <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <svg className="w-9 h-9 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"/>
          </svg>
        </div>
        <div className="text-center space-y-2">
          <h2 className="font-display font-extrabold text-white text-xl">Session Expired</h2>
          <p className="text-sm text-white/50 font-body max-w-xs leading-relaxed">
            Your internet session has ended. You'll be disconnected from the
            network shortly — reconnect to WiFi to start a new session.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-8 py-5 text-center w-full">
          <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-white/30 mb-2">
            Disconnecting in
          </p>
          <p className="font-mono text-5xl font-bold text-amber-400 tabular-nums">
            {fmtGrace(graceMs)}
          </p>
          <p className="text-[10px] text-white/25 font-body mt-2">
            Reconnect to WiFi after disconnection to get a new session
          </p>
        </div>
        {/* Offline apps still accessible during grace */}
        <div className="w-full rounded-xl border border-white/[0.07] overflow-hidden">
          <button onClick={() => setShowApps(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3.5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-signal/10 border border-signal/20 flex items-center justify-center">
                <IconGrid className="w-3.5 h-3.5 text-signal"/>
              </div>
              <div className="text-left">
                <p className="text-[12px] font-display font-bold text-white leading-none">Offline Apps</p>
                <p className="text-[9px] text-white/30 font-body mt-0.5">Still available</p>
              </div>
            </div>
            <svg className={`w-4 h-4 text-white/25 transition-transform duration-200 ${showApps ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="6,9 12,15 18,9"/>
            </svg>
          </button>
          {showApps && (
            <div className="border-t border-white/[0.05] bg-white/[0.01] p-3 space-y-2">
              {OFFLINE_APPS.map(({ name, desc, url, Icon }) => (
                <a key={name} href={url}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.07]
                    bg-white/[0.03] hover:bg-white/[0.06] transition-colors no-underline group">
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
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Active session ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col px-5 py-6 gap-5 animate-fade-up">

      {/* Header */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow"/>
          <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua flex items-center justify-center shadow-lg">
            <svg className="w-7 h-7 text-void" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
        </div>
        <div className="text-center">
          <p className="font-display font-extrabold text-white text-xl mb-0.5">You're Online!</p>
          <p className="text-xs text-white/40 font-body">{config?.campaign?.name ?? 'CityNet'} · free internet access</p>
        </div>
      </div>

      {/* Session countdown */}
      {tl && expiresAt && (
        <div className={`rounded-xl border px-5 py-4 transition-colors duration-700
          ${tl.urgent ? 'bg-red-500/[0.07] border-red-500/20' : 'bg-signal/[0.06] border-signal/20'}`}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-white/40">Session Time Remaining</p>
            <span className={`text-[9px] font-display font-bold uppercase tracking-wider ${tl.urgent ? 'text-red-400' : 'text-signal/70'}`}>
              {tl.urgent ? '⚠ Expiring soon' : 'Active'}
            </span>
          </div>
          <div className={`font-mono text-4xl font-bold tabular-nums text-center mb-3 ${tl.urgent ? 'text-red-400' : 'text-white'}`}>
            {tl.h > 0 && `${tl.h}:`}{fmt2(tl.m)}:{fmt2(tl.s)}
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-1000 ${tl.urgent ? 'bg-red-400' : 'bg-gradient-to-r from-signal to-aqua'}`}
              style={{ width: `${Math.round(tl.pct * 100)}%` }}/>
          </div>
          <p className="text-[10px] text-white/25 font-body text-center mt-2">
            {Math.ceil(tl.totalMs / 60000)} min of {sessionHours * 60} min remaining
          </p>
        </div>
      )}

      {!expiresAt && status?.accessGranted && (
        <div className="rounded-xl border border-signal/20 bg-signal/[0.06] px-5 py-4 text-center">
          <p className="text-[11px] text-white/40 font-body">Session active · expiry time not available</p>
        </div>
      )}

      {/* Start Browsing (before internet confirmed) → Session Active card (after) */}
      {!internetConfirmed ? (
        <button
          disabled={false}
          onClick={() => {
            // Open browser directly — backend has confirmed access via chilli_query.
            // We open about:blank synchronously (required to bypass popup blocker)
            // then navigate it. A small delay lets iptables fully settle.
            const tab = window.open('about:blank', '_blank');
            setTimeout(() => {
              if (tab && !tab.closed) tab.location.href = 'https://google.com';
              setInternetConfirmed(true);
            }, 800);
          }}
          className="w-full py-4 rounded-xl font-display font-bold text-base
            bg-gradient-to-r from-signal to-aqua text-void shadow-lg shadow-signal/20
            active:scale-[0.98] transition-all duration-150
            disabled:opacity-60 disabled:cursor-wait">
          <span>Start Browsing →</span>
        </button>
      ) : (
        /* ── Session Active card — shown once internet is confirmed ── */
        <div className="relative overflow-hidden rounded-2xl border border-signal/30">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-signal/[0.12] via-aqua/[0.06] to-transparent"/>
          {/* Subtle animated shimmer */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent
            -translate-x-full animate-[shimmer_3s_ease-in-out_infinite]"/>
          <div className="relative px-5 py-4 flex items-center gap-4">
            {/* Icon with glow */}
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-full bg-signal/30 blur-md"/>
              <div className="relative w-11 h-11 rounded-full bg-gradient-to-br from-signal to-aqua
                flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-void" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
                </svg>
              </div>
            </div>
            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="font-display font-extrabold text-white text-[14px] leading-none mb-1">
                Internet Active
              </p>
              <p className="text-[11px] text-white/50 font-body">
                If not, Reload this Page !!
              </p>
            </div>
            {/* Live indicator */}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-signal opacity-70"/>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-signal"/>
              </span>
              <span className="text-[8px] font-display font-bold text-signal/70 uppercase tracking-wider">Live</span>
            </div>
          </div>
        </div>
      )}

      {/* Offline apps */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <button onClick={() => setShowApps(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3.5
            bg-white/[0.02] hover:bg-white/[0.04] transition-colors active:bg-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-signal/10 border border-signal/20 flex items-center justify-center">
              <IconGrid className="w-3.5 h-3.5 text-signal"/>
            </div>
            <div className="text-left">
              <p className="text-[12px] font-display font-bold text-white leading-none">Offline Apps</p>
              <p className="text-[9px] text-white/30 font-body mt-0.5">Available without internet</p>
            </div>
          </div>
          <svg className={`w-4 h-4 text-white/25 transition-transform duration-200 ${showApps ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="6,9 12,15 18,9"/>
          </svg>
        </button>
        {showApps && (
          <div className="border-t border-white/[0.05] bg-white/[0.01] p-3 space-y-2">
            {OFFLINE_APPS.map(({ name, desc, url, Icon }) => (
              <a key={name} href={url}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.07]
                  bg-white/[0.03] hover:bg-white/[0.06] active:bg-white/[0.08] transition-colors no-underline group">
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
            <button onClick={() => navigate('/offline')}
              className="w-full text-center text-[10px] text-signal/60 font-display font-bold
                uppercase tracking-wider py-2 hover:text-signal transition-colors">
              View all apps →
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => { setStatus(null); navigate('/', { replace: true }); }}
        className="w-full text-center text-[10px] text-white/20 font-body py-1 hover:text-white/40 transition-colors">
        ← Back to Campaigns
      </button>
    </div>
  );
}