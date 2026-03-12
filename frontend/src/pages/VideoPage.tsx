import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { portalApi } from '../lib/api';
import { IconArrow, IconPlay } from '../components/layout/Shell';

export function VideoPage() {
  const { selectedSlug, status, config, loading, refresh } = usePortal();
  const navigate = useNavigate();

  const videoRef     = useRef<HTMLVideoElement>(null);
  const [watchedPct, setWatchedPct]   = useState(0);
  const [canContinue, setCanContinue] = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (!selectedSlug) { navigate('/', { replace: true }); return; }
    if (!loading && !config) refresh();
  }, [selectedSlug]);

  useEffect(() => {
    if (loading) return;
    if (status?.active || status?.accessGranted) {
      navigate('/connecting', { replace: true }); return;
    }
    if (status?.videoWatched) {
      navigate('/survey', { replace: true }); return;
    }
  }, [loading, status]);

  const requiredPct = config?.video?.requiredWatchPct ?? 0.8;

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const pct = v.currentTime / v.duration;
    setWatchedPct(pct);
    if (pct >= requiredPct) setCanContinue(true);
  };

  const handleContinue = async () => {
    if (!canContinue || !status || !selectedSlug || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await portalApi.videoComplete(selectedSlug, status.sessionId, watchedPct);
      await refresh();
      navigate('/survey', { replace: true });
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Failed — try again');
    }
  };

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
            <span>Loading…</span>
          </>
        ) : (
          <>
            <span>{canContinue ? 'Continue to Survey' : `Watch ${Math.round(requiredPct * 100)}% to continue`}</span>
            {canContinue && <IconArrow className="w-4 h-4" />}
          </>
        )}
      </button>
    </div>
  );
}
