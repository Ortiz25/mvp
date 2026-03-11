// src/pages/WelcomePage.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';

const features = [
  { icon: '▶️', label: 'Watch a short video',    color: 'from-blue-500/20 to-blue-600/10',    border: 'border-blue-500/20' },
  { icon: '📋', label: 'Quick community survey', color: 'from-orange-500/20 to-orange-600/10', border: 'border-orange-500/20' },
  { icon: '🌐', label: 'Free internet access',   color: 'from-brand-500/20 to-brand-600/10',   border: 'border-brand-500/20' },
  { icon: '📚', label: 'Kolibri learning hub',   color: 'from-purple-500/20 to-purple-600/10', border: 'border-purple-500/20' },
];

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
      <p className="text-sm text-white/30 font-body">Loading…</p>
    </div>
  );
}

export function WelcomePage() {
  const { status, campaign, loading } = usePortal();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (status?.active)                             { navigate('/success', { replace: true }); return; }
    if (status?.videoWatched && status.surveyDone)  { navigate('/success', { replace: true }); return; }
    if (status?.videoWatched && !status.surveyDone) { navigate('/survey',  { replace: true }); return; }
  }, [loading, status]);

  if (loading) return <LoadingState />;

  const camp = campaign?.campaign;

  return (
    <div className="px-6 py-7 flex flex-col items-center text-center">
      {/* Icon */}
      <div className="animate-fade-up relative mb-6">
        <div className="absolute inset-0 rounded-full bg-brand-500/20 blur-xl animate-pulse-slow" />
        <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-brand-400 to-cyan-500
          flex items-center justify-center text-4xl glow-brand">
          📡
        </div>
      </div>

      <h2 className="animate-fade-up delay-100 font-display font-extrabold text-2xl
        tracking-tight text-white mb-2">
        Free Wi-Fi Access
      </h2>

      {camp && (
        <div className="animate-fade-up delay-100 inline-flex items-center gap-1.5 mb-3
          bg-brand-500/10 border border-brand-500/25 rounded-full px-3 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse-slow" />
          <span className="text-xs font-display font-semibold text-brand-400">
            {camp.sponsor ? `${camp.name} · ${camp.sponsor}` : camp.name}
          </span>
        </div>
      )}

      <p className="animate-fade-up delay-200 text-sm text-white/50 font-body leading-relaxed
        max-w-[280px] mb-7">
        {camp?.description || 'Connect to the internet in 3 simple steps — free, powered by your community.'}
      </p>

      {/* Feature grid */}
      <div className="animate-fade-up delay-300 grid grid-cols-2 gap-2.5 w-full mb-7">
        {features.map(({ icon, label, color, border }) => (
          <div key={label} className={`rounded-xl border ${border} bg-gradient-to-br ${color}
            p-3.5 flex flex-col items-center gap-2`}>
            <span className="text-2xl">{icon}</span>
            <span className="text-[11px] text-white/65 font-body font-medium text-center leading-tight">
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="animate-fade-up delay-400 w-full">
        {camp ? (
          <button onClick={() => navigate('/watch')} className="btn-primary">
            Get Started →
          </button>
        ) : (
          <div className="py-4 rounded-xl bg-white/5 border border-white/10
            text-white/40 text-sm font-body text-center">
            No active campaign — check back soon
          </div>
        )}
        <p className="mt-3 text-[10px] text-white/20 font-body">
          By continuing you agree to our acceptable use policy
        </p>
      </div>
    </div>
  );
}
