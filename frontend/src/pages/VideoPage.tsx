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

  // Fix 1+2: completedThisVisit is set to true as soon as the user clicks
  // Continue (before navigation) — prevents false drop-off beacon firing
  // during the brief visibility-hidden moment that occurs on SPA navigation.
  // Also prevents the beacon using a stale sessionId after 'always' mode
  // creates a new session.
  const completedThisVisit = useRef(false);

  // Fix 3: track whether we've already fired the video/start ping
  const startPingFired = useRef(false);

  // Ref mirrors watchedPct for use in event listener closures (stale-closure fix)
  const watchedPctRef = useRef(0);
  useEffect(() => { watchedPctRef.current = watchedPct; }, [watchedPct]);

  useEffect(() => {
    if (!selectedSlug) { navigate('/', { replace: true }); return; }
    if (!loading && !config) refresh();
  }, [selectedSlug]);

  // Guard: survey-only campaign — don't show VideoPage
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

    const freq          = status?.watchFrequency  ?? 'once_per_day';
    const requireSurvey = config?.campaign?.requireSurvey ?? status?.requireSurvey ?? true;

    if (status?.videoWatched && !completedThisVisit.current) {
      if (freq === 'always') return;
      if (!requireSurvey) return;
      const msg = freq === 'once_ever'
        ? "You have already watched this campaign's content. Pick another campaign to get access."
        : "You have already watched today's content. Come back tomorrow or pick another campaign.";
      navigate('/', { replace: true, state: { notice: msg, dismissedSlug: selectedSlug } });
    }
  }, [loading, status, config]);

  // ── Drop-off beacon ───────────────────────────────────────────────────────
  // Fix 1: completedThisVisit is set BEFORE navigate() in handleContinue, so
  //   visibilitychange during SPA navigation no longer fires the beacon.
  // Fix 2: sessionId is captured at effect registration time. If 'always' mode
  //   creates a new session on the next cycle, a new mount re-registers the
  //   effect with the new sessionId. The old closure correctly references the
  //   old sessionId — but markVideoDropOff's !completed guard prevents
  //   double-marking a session that was already completed.
  useEffect(() => {
    if (!selectedSlug || !status?.sessionId) return;
    const sessionId = status.sessionId; // captured — won't go stale for this mount

    const sendDropOff = () => {
      if (completedThisVisit.current) return;
      const pct = watchedPctRef.current;
      if (pct < 0.01) return; // never played — not a drop-off
      try {
        navigator.sendBeacon(
          `/api/${selectedSlug}/video/dropoff`,
          JSON.stringify({ sessionId, watchedPct: pct })
        );
      } catch {}
    };

    const onVisibility = () => { if (document.hidden) sendDropOff(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide',     sendDropOff); // iOS Safari
    window.addEventListener('beforeunload', sendDropOff);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide',     sendDropOff);
      window.removeEventListener('beforeunload', sendDropOff);
    };
  }, [selectedSlug, status?.sessionId]);

  // ── Progress heartbeat every 5 s ─────────────────────────────────────────
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

    // Fix 3: fire video/start once when playback reaches 1 second
    // (avoids counting scrubbers/seekers who jump around without watching)
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
      await portalApi.videoComplete(selectedSlug, status.sessionId, watchedPctRef.current);

      // Fix 1: set completedThisVisit BEFORE any navigation so that the
      // visibilitychange event (which briefly fires hidden=true during SPA
      // route transitions in some browsers) does not trigger a false drop-off.
      completedThisVisit.current = true;

      const requireSurvey =
        config?.campaign?.requireSurvey ?? status?.requireSurvey ?? true;

      if (requireSurvey) {
        await refresh();
        navigate('/survey', { replace: true });
        return;
      }

      // No survey — grant here
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
      navigate('/connecting', { replace: true });

    } catch (e) {
      // Grant or videoComplete failed — reset so user can retry
      completedThisVisit.current = false;
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

  const video    = config?.video;
  const noSurvey = config?.campaign?.requireSurvey === false;

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
