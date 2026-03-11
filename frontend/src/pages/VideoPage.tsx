import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { portalApi } from '../lib/api';
import { IconPlay, IconArrow, IconCheck } from '../components/layout/Shell';

export function VideoPage() {
  const { selectedSlug, status, config, loading, refresh } = usePortal();
  const navigate = useNavigate();

  const [progress,   setProgress]   = useState(0);
  const [playing,    setPlaying]    = useState(false);
  const [done,       setDone]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const video    = config?.video;
  const required = video?.requiredWatchPct ?? 0.8;
  const duration = video?.durationSeconds  ?? 120;

  useEffect(() => {
    if (!selectedSlug) { navigate('/', { replace: true }); return; }
    refresh();
  }, [selectedSlug]);

  useEffect(() => {
    if (!loading && status?.videoWatched) {
      config?.survey?.questions?.length
        ? navigate('/survey', { replace: true })
        : navigate('/success', { replace: true });
    }
    return () => clearInterval(timerRef.current);
  }, [loading, status, config]);

  const toggleDemo = () => {
    if (done) return;
    if (playing) { clearInterval(timerRef.current); setPlaying(false); }
    else {
      setPlaying(true);
      timerRef.current = setInterval(() => {
        setProgress(p => {
          const next = p + 1 / (duration * 4);
          if (next >= required) {
            clearInterval(timerRef.current);
            setPlaying(false); setDone(true);
            return Math.min(next, 1);
          }
          return next;
        });
      }, 100);
    }
  };

  const handleContinue = async () => {
    if (!status || !selectedSlug || submitting) return;
    setSubmitting(true); setError('');
    try {
      await portalApi.videoComplete(selectedSlug, status.sessionId, progress);
      await refresh();
      config?.survey?.questions?.length ? navigate('/survey') : navigate('/success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save progress');
    } finally { setSubmitting(false); }
  };

  const pct    = Math.round(progress * 100);
  const reqPct = Math.round(required * 100);
  const ready  = pct >= reqPct;

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-5 py-5">
      {/* Header */}
      <div className="mb-4 animate-fade-up">
        <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-signal/60 mb-1.5">
          Step 02 — Watch Video
        </p>
        <h2 className="font-display font-extrabold text-[20px] text-white leading-tight tracking-tight mb-1">
          {video?.title ?? config?.campaign?.name ?? 'Watch to Continue'}
        </h2>
        <p className="text-[12px] text-white/35 font-body">
          Watch at least <span className="text-white/60 font-medium">{reqPct}%</span> to unlock internet access
        </p>
      </div>

      {/* Video player */}
      <div className="animate-fade-up anim-d1 mb-3 rounded-2xl overflow-hidden
        border border-white/[0.08] bg-night relative" style={{ aspectRatio: '16/9' }}>

        {video?.url ? (
          <video src={video.url} className="w-full h-full object-cover" controls playsInline
            onTimeUpdate={e => {
              const v = e.currentTarget;
              const p = v.currentTime / (v.duration || duration);
              setProgress(p);
              if (p >= required) setDone(true);
            }}
          />
        ) : (
          /* Dev-mode placeholder */
          <button onClick={toggleDemo}
            className="absolute inset-0 w-full flex flex-col items-center justify-center gap-3 group">
            {/* Scan line animation when playing */}
            {playing && (
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute w-full h-8 bg-gradient-to-b from-transparent via-signal/5 to-transparent animate-scan" />
              </div>
            )}
            <div className={`relative w-14 h-14 rounded-full border-2 flex items-center justify-center
              transition-all duration-300
              ${done    ? 'border-signal bg-signal/20 text-signal shadow-signal'
              : playing ? 'border-white/40 bg-white/10 text-white/80 scale-95'
                        : 'border-white/20 bg-white/[0.05] text-white/40 group-hover:border-white/30 group-hover:text-white/60'}`}>
              {done
                ? <IconCheck className="w-6 h-6" />
                : playing
                ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                : <IconPlay className="w-6 h-6" />
              }
            </div>
            <p className="relative text-[11px] text-white/35 font-body px-6 text-center leading-relaxed">
              {done ? 'Video complete — tap Continue'
               : playing ? 'Tap to pause'
               : progress > 0 ? 'Paused — tap to resume'
               : 'No video uploaded · tap to simulate (dev mode)'}
            </p>
          </button>
        )}

        {/* Progress bar at bottom */}
        <div className="absolute bottom-0 left-0 right-0">
          <div className="h-[3px] bg-black/50">
            <div className="prog-fill h-full" style={{ width: `${pct}%` }} />
            <div className="absolute top-0 h-full w-0.5 bg-white/50 -translate-x-px"
              style={{ left: `${reqPct}%` }} />
          </div>
        </div>
      </div>

      {/* Progress stats */}
      <div className="flex items-center justify-between mb-4 animate-fade-up anim-d2">
        <div className="flex items-center gap-2.5">
          <div className="prog-track w-28">
            <div className="prog-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-white/30 font-mono tabular-nums">{pct}%</span>
        </div>
        <span className={`text-[11px] font-display font-semibold transition-colors duration-300
          ${ready ? 'text-signal' : 'text-white/25'}`}>
          {ready ? (
            <span className="flex items-center gap-1"><IconCheck className="w-3.5 h-3.5" /> Ready</span>
          ) : `${reqPct - pct}% remaining`}
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/[0.07] border border-red-500/20 text-sm text-red-400 font-body">
          {error}
        </div>
      )}

      {/* CTA */}
      <div className="animate-fade-up anim-d3">
        <button onClick={handleContinue} disabled={!ready || submitting} className="btn-primary flex items-center justify-center gap-2.5">
          {submitting ? (
            <><span className="w-4 h-4 rounded-full border-2 border-void/40 border-t-void animate-spin" /><span>Saving…</span></>
          ) : ready ? (
            <><span>{config?.survey?.questions?.length ? 'Continue to Survey' : 'Get Internet Access'}</span>
            <IconArrow className="w-4 h-4" /></>
          ) : `Watch ${reqPct - pct}% more to continue`}
        </button>
      </div>
    </div>
  );
}
