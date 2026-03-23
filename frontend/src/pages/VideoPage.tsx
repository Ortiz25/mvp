import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { portalApi } from '../lib/api';
import { IconArrow, IconPlay } from '../components/layout/Shell';

const SS_KEY = 'cp_hotspot_v3';

/** Clear the one-time CoovaChilli challenge from sessionStorage after use. */
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

  const videoRef      = useRef<HTMLVideoElement>(null);
  const [watchedPct,  setWatchedPct]  = useState(0);
  const [canContinue, setCanContinue] = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');

  // Tracks whether the video was completed in THIS browser visit.
  // Prevents stale DB videoWatched=true (from a previous grant cycle in
  // 'always' mode) from skipping the video on the next session.
  const completedThisVisit = useRef(false);

  useEffect(() => {
    if (!selectedSlug) { navigate('/', { replace: true }); return; }
    if (!loading && !config) refresh();
  }, [selectedSlug]);

  useEffect(() => {
    if (loading) return;

    // Already active — go straight to connecting
    if (status?.active || status?.accessGranted) {
      navigate('/connecting', { replace: true }); return;
    }

    const freq = status?.watchFrequency ?? 'once_per_day';

    // ── 'always' mode fix ────────────────────────────────────────────────
    // In 'always' mode the DB may still carry videoWatched=true from the
    // *previous* grant cycle (needsNewSession only resets after the expired
    // session is seen on the next /status call). Never skip the video based
    // on the DB flag alone — only act once the user has watched it THIS visit.
    if (status?.videoWatched && !completedThisVisit.current) {
      if (freq === 'always') {
        return; // Stay — let them watch again
      }
      // once_per_day / once_ever: genuinely already consumed this window
      const msg = freq === 'once_ever'
        ? "You have already watched this campaign's content. Pick another campaign to get access."
        : "You have already watched today's content for this campaign. Come back tomorrow or pick another campaign.";
      navigate('/', { replace: true, state: { notice: msg, dismissedSlug: selectedSlug } });
    }
  }, [loading, status]);

  // ── Drop-off beacon ───────────────────────────────────────────────────
  // Fires when the user navigates away or hides the tab without finishing.
  useEffect(() => {
    if (!selectedSlug || !status?.sessionId) return;

    const sendDropOff = () => {
      if (completedThisVisit.current) return;
      const pct = videoRef.current
        ? videoRef.current.currentTime / (videoRef.current.duration || 1)
        : 0;
      if (pct < 0.01) return;
      try {
        navigator.sendBeacon(
          `/api/${selectedSlug}/video/dropoff`,
          JSON.stringify({ sessionId: status.sessionId })
        );
      } catch {}
    };

    const onVisibility = () => { if (document.hidden) sendDropOff(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', sendDropOff);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', sendDropOff);
    };
  }, [selectedSlug, status?.sessionId]);

  // ── Progress heartbeat (every 5 s) ───────────────────────────────────
  useEffect(() => {
    if (!selectedSlug || !status?.sessionId) return;
    const id = setInterval(() => {
      if (watchedPct > 0.01 && !completedThisVisit.current) {
        portalApi.videoProgress(selectedSlug, status.sessionId, watchedPct).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(id);
  }, [selectedSlug, status?.sessionId, watchedPct]);

  const requiredPct = config?.video?.requiredWatchPct ?? 0.8;

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const pct = v.currentTime / v.duration;
    setWatchedPct(pct);
    if (pct >= requiredPct && !canContinue) setCanContinue(true);
  };

  const handleContinue = useCallback(async () => {
    if (!canContinue || !status || !selectedSlug || submitting) return;
    setSubmitting(true);
    setError('');

    try {
      // 1. Tell backend video is done
      await portalApi.videoComplete(selectedSlug, status.sessionId, watchedPct);
      completedThisVisit.current = true;

      // 2. Decide: does this campaign need a survey?
      const requireSurvey =
        config?.campaign?.requireSurvey ??
        status?.requireSurvey ??
        true;

      if (requireSurvey) {
        // Survey required — let SurveyPage handle the grant
        await refresh();
        navigate('/survey', { replace: true });
        return;
      }

      // ── No survey — grant access right here ─────────────────────────
      await portalApi.grantAccess(selectedSlug, status.sessionId, hotspot.challenge);
      clearChallenge();
      // Do NOT call refresh() — same reason as in SurveyPage:
      // refresh() → /status → getOrCreateSession() creates a fresh session
      // for 'always' campaigns, making ConnectingPage see accessGranted=false.
      navigate('/connecting', { replace: true });

    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Failed — try again');
    }
  }, [canContinue, status, selectedSlug, submitting, watchedPct, config, hotspot]);

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
      </div>
    );
  }

  const video = config?.video;

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

      {/* Progress bar */}
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
            <span>{config?.campaign?.requireSurvey === false ? 'Getting access…' : 'Loading…'}</span>
          </>
        ) : (
          <>
            <span>
              {canContinue
                ? (config?.campaign?.requireSurvey === false ? 'Get Internet Access' : 'Continue to Survey')
                : `Watch ${Math.round(requiredPct * 100)}% to continue`}
            </span>
            {canContinue && <IconArrow className="w-4 h-4" />}
          </>
        )}
      </button>
    </div>
  );
}
