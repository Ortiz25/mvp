import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { portalApi } from '../lib/api';
import { IconArrow, IconPlay } from '../components/layout/Shell';

const SS_KEY = 'cp_hotspot_v3';

function clearChallenge() {
  try {
    const stored = sessionStorage.getItem(SS_KEY);
    if (stored) {
      const p = JSON.parse(stored);
      p.challenge = null;
      sessionStorage.setItem(SS_KEY, JSON.stringify(p));
    }
  } catch {}
}

export function VideoPage() {
  const { selectedSlug, status, config, loading, refresh, hotspot } = usePortal();
  const navigate = useNavigate();

  const videoRef        = useRef<HTMLVideoElement>(null);
  const [watchedPct,    setWatchedPct]    = useState(0);
  const [canContinue,   setCanContinue]   = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState('');

  // completedThisVisit: video was completed AND access was successfully
  // granted in this page visit. Reset to false on every mount so the user
  // can always re-watch if they return (e.g. grant failed and they came back).
  const completedThisVisit = useRef(false);

  // Fix 3: track whether video/start has been sent for this session
  const startPingFired = useRef(false);

  // Keep a ref to the latest watchedPct so the drop-off beacon closure
  // always reads the current value (state closures in event listeners are stale).
  const watchedPctRef = useRef(0);
  useEffect(() => { watchedPctRef.current = watchedPct; }, [watchedPct]);

  useEffect(() => {
    if (!selectedSlug) { navigate('/', { replace: true }); return; }
    if (!loading && !config) refresh();
  }, [selectedSlug]);

  // Guard: if this campaign doesn't require a video, don't show VideoPage at all.
  // Can happen if user lands on /watch via back button or direct URL.
  useEffect(() => {
    if (!config) return;
    if (config.campaign?.requireVideo === false) {
      navigate('/survey', { replace: true });
    }
  }, [config]);

  useEffect(() => {
    if (loading) return;
    if (status?.active || status?.accessGranted) {
      navigate('/connecting', { replace: true }); return;
    }

    const freq         = status?.watchFrequency  ?? 'once_per_day';
    const requireSurvey = config?.campaign?.requireSurvey ?? status?.requireSurvey ?? true;

    // videoWatched=true in DB means:
    //   - 'always' mode: stale from previous cycle — let them re-watch
    //   - 'once_per_day' / 'once_ever' WITH survey: already consumed this window
    //   - no-survey campaign: videoWatched+accessGranted should have happened
    //     together — if we're here with videoWatched=true but not granted,
    //     it means a previous grant attempt failed. Let them retry: don't navigate away.
    if (status?.videoWatched && !completedThisVisit.current) {
      if (freq === 'always') return; // always mode — re-watch every session

      if (freq === 'once_ever') {
        // once_ever: user permanently completed engagement in a prior session.
        // Skip video, go to survey (or straight to grant if survey also done).
        navigate('/survey', { replace: true });
        return;
      }

      // once_per_day: video_watched=true means they already used today's session.
      // Navigate back to picker with restriction info so the card is greyed out.
      navigate('/', { replace: true, state: {
        dismissedSlug: selectedSlug,
        dismissedFreq: freq,   // 'once_per_day' — card shows "come back tomorrow"
      }});
    }
  }, [loading, status, config]);

  // ── Drop-off beacon ───────────────────────────────────────────────────────
  // Uses a ref for watchedPct to avoid the stale-closure problem with state
  // inside event listeners that are only registered once.
  useEffect(() => {
    if (!selectedSlug || !status?.sessionId) return;
    const sessionId = status.sessionId;

    const sendDropOff = () => {
      if (completedThisVisit.current) return;
      const pct = watchedPctRef.current;
      if (pct < 0.01) return; // never really started — don't record
      try {
        navigator.sendBeacon(
          `/api/${selectedSlug}/video/dropoff`,
          JSON.stringify({ sessionId, watchedPct: pct })
        );
      } catch {}
    };

    const onVisibility = () => { if (document.hidden) sendDropOff(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide',    sendDropOff); // mobile Safari
    window.addEventListener('beforeunload', sendDropOff);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide',    sendDropOff);
      window.removeEventListener('beforeunload', sendDropOff);
    };
  }, [selectedSlug, status?.sessionId]); // intentionally not including watchedPct — using ref

  // ── Progress heartbeat every 5 s ──────────────────────────────────────────
  useEffect(() => {
    if (!selectedSlug || !status?.sessionId) return;
    const sessionId = status.sessionId;
    const id = setInterval(() => {
      const pct = watchedPctRef.current;
      if (pct > 0.01 && !completedThisVisit.current) {
        portalApi.videoProgress(selectedSlug, sessionId, pct).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(id);
  }, [selectedSlug, status?.sessionId]);

  const requiredPct = config?.video?.requiredWatchPct ?? 0.8;

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const pct = v.currentTime / v.duration;
    setWatchedPct(pct);
    if (pct >= requiredPct && !canContinue) setCanContinue(true);

    // Fix 3: fire video/start once at 1 second of playback
    if (!startPingFired.current && v.currentTime >= 1 && status?.sessionId && selectedSlug) {
      startPingFired.current = true;
      portalApi.videoStart(selectedSlug, status.sessionId).catch(() => {});
    }
  };

  const handleContinue = useCallback(async () => {
    if (!canContinue || !status || !selectedSlug || submitting) return;
    setSubmitting(true);
    setError('');

    try {
      // 1. Mark video watched (idempotent — safe to call even if already set)
      await portalApi.videoComplete(selectedSlug, status.sessionId, watchedPctRef.current);

      const requireSurvey =
        config?.campaign?.requireSurvey ?? status?.requireSurvey ?? true;

      if (requireSurvey) {
        // Fix 1: set completedThisVisit BEFORE navigate so visibilitychange
        // during SPA route transition doesn't fire a false drop-off beacon
        completedThisVisit.current = true;
        await refresh();
        navigate('/survey', { replace: true });
        return;
      }

      // ── No-survey: grant access here ──────────────────────────────────────
      let challenge = hotspot.challenge;
      if (!challenge) {
        try {
          const r = await fetch(
            `/api/${selectedSlug}/challenge${status.mac ? `?mac=${status.mac}` : ''}`
          );
          if (r.ok) { const d = await r.json(); challenge = d.challenge ?? null; }
        } catch {}
      }

      await portalApi.grantAccess(selectedSlug, status.sessionId, challenge);
      clearChallenge();

      // Mark fully done only after a successful grant — so if grant fails and
      // the user comes back to /watch, completedThisVisit stays false and they
      // can retry without being routed away.
      completedThisVisit.current = true;

      navigate('/connecting', { replace: true });

    } catch (e) {
      completedThisVisit.current = false; // reset so user can retry
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Failed — try again');
    }
  }, [canContinue, status, selectedSlug, submitting, config, hotspot]);

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
      </div>
    );
  }

  const video       = config?.video;
  const noSurvey    = config?.campaign?.requireSurvey === false;

  return (
    <div className="px-5 py-5">
      <div className="mb-4 animate-fade-up">
        <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-signal/60 mb-1.5">
          Step 02 — Watch
        </p>
        <h2 className="font-display font-extrabold text-[20px] text-white leading-tight tracking-tight">
          {video?.title ?? 'Watch the video'}
        </h2>
      </div>

      {video?.url ? (
        <div className="rounded-2xl overflow-hidden border border-white/[0.08] mb-4 animate-fade-up anim-d1">
          <video
            ref={videoRef}
            src={video.url}
            controls
            playsInline
            className="w-full aspect-video bg-black"
            onTimeUpdate={handleTimeUpdate}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] aspect-video
          flex items-center justify-center mb-4 animate-fade-up anim-d1">
          <div className="text-center">
            <IconPlay className="w-10 h-10 text-white/20 mx-auto mb-2" />
            <p className="text-sm text-white/30 font-body">No video configured</p>
          </div>
        </div>
      )}

      <div className="mb-4 animate-fade-up anim-d2">
        <div className="flex justify-between text-[10px] text-white/30 font-body mb-1.5">
          <span>Progress</span>
          <span>{Math.round(watchedPct * 100)}% / {Math.round(requiredPct * 100)}% required</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal to-aqua transition-all duration-300"
            style={{ width: `${Math.min(watchedPct / requiredPct, 1) * 100}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/[0.07] border border-red-500/20 text-sm text-red-400 font-body">
          {error}
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={!canContinue || submitting}
        className="btn-primary flex items-center justify-center gap-2.5 animate-fade-up anim-d3">
        {submitting ? (
          <>
            <span className="w-4 h-4 rounded-full border-2 border-void/40 border-t-void animate-spin" />
            <span>{noSurvey ? 'Getting access…' : 'Loading…'}</span>
          </>
        ) : (
          <>
            <span>
              {canContinue
                ? (noSurvey ? 'Get Internet Access' : 'Continue to Survey')
                : `Watch ${Math.round(requiredPct * 100)}% to continue`}
            </span>
            {canContinue && <IconArrow className="w-4 h-4" />}
          </>
        )}
      </button>
    </div>
  );
}
