import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { listCampaigns, CampaignSummary } from '../lib/api';
import { IconSignal, IconClock, IconPlay, IconCheck, IconArrow } from '../components/layout/Shell';

function WifiArc({ strength = 3 }: { strength?: number }) {
  return (
    <svg viewBox="0 0 36 24" className="w-9 h-6" fill="none">
      {[0,1,2].map(i => (
        <path key={i}
          d={['M2 22 Q18 3 34 22','M6 18 Q18 7 30 18','M10.5 14 Q18 10 25.5 14'][i]}
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          opacity={i < strength ? 1 : 0.12}
        />
      ))}
      <circle cx="18" cy="22" r="2" fill="currentColor" />
    </svg>
  );
}

function CampaignCard({ camp, selected, onClick }: { camp: CampaignSummary; selected: boolean; onClick: () => void }) {
  const watchPct = Math.round((camp.video_required_pct ?? 0.8) * 100);

  return (
    <button onClick={onClick}
      className={`campaign-card ${selected ? 'campaign-card-selected' : ''}`}>
      {selected && <div className="h-[2px] bg-gradient-to-r from-signal to-aqua" />}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="min-w-0 flex-1">
            <h3 className="font-display font-bold text-white text-[15px] leading-tight truncate mb-0.5">
              {camp.name}
            </h3>
            {camp.sponsor && (
              <p className="text-[10px] text-white/35 font-body">by {camp.sponsor}</p>
            )}
          </div>
          <div className={`shrink-0 transition-all duration-300
            ${selected ? 'text-signal' : 'text-white/20'}`}>
            <WifiArc strength={selected ? 3 : 2} />
          </div>
        </div>

        {camp.description && (
          <p className="text-[12px] text-white/40 font-body leading-relaxed mb-3 line-clamp-2">
            {camp.description}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <span className="chip chip-muted gap-1">
            <IconClock className="w-3 h-3" />
            {camp.session_hours}h access
          </span>
          {camp.video_filename ? (
            <span className="chip chip-info gap-1">
              <IconPlay className="w-3 h-3" />
              Watch {watchPct}%
            </span>
          ) : (
            <span className="chip chip-muted gap-1">
              <IconPlay className="w-3 h-3" />
              No video
            </span>
          )}
          {selected && (
            <span className="chip chip-live gap-1 ml-auto">
              <IconCheck className="w-3 h-3" />
              Selected
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function PickerPage() {
  const navigate = useNavigate();
  const { selectCampaign, refresh } = usePortal();
  const [campaigns,   setCampaigns]   = useState<CampaignSummary[]>([]);
  const [selected,    setSelected]    = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [starting,    setStarting]    = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    setLoadingList(true);
    listCampaigns()
      .then(list => {
        setCampaigns(list);
        if (list.length === 1) setSelected(list[0].slug);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load campaigns'))
      .finally(() => setLoadingList(false));
  }, []);

  const handleStart = async () => {
    if (!selected || starting) return;
    setStarting(true); setError('');
    try {
      selectCampaign(selected);
      await refresh(selected);
      navigate('/watch');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session');
      setStarting(false);
    }
  };

  return (
    <div className="px-5 py-6">
      {/* Hero */}
      <div className="mb-5 animate-fade-up">
        <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-signal/60 mb-2">
          Step 01 — Select Campaign
        </p>
        <h2 className="font-display font-extrabold text-[22px] text-white leading-tight tracking-tight mb-1.5">
          Get Free Internet<br />
          <span className="text-gradient">Access Today</span>
        </h2>
        <p className="text-[12px] text-white/35 font-body leading-relaxed">
          Pick a campaign, watch a short clip, get online — no sign-up needed.
        </p>
      </div>

      {/* Campaign list */}
      <div className="mb-5 animate-fade-up anim-d2">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[9px] font-display font-bold uppercase tracking-[0.15em] text-white/25">
            Available
          </p>
          {campaigns.length > 0 && (
            <span className="text-[9px] font-mono text-white/20">{campaigns.length} active</span>
          )}
        </div>

        {loadingList ? (
          <div className="flex flex-col items-center py-14 gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-signal/20 border-t-signal animate-spin" />
            <p className="text-xs text-white/25 font-body">Loading campaigns…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-4 text-center">
            <p className="text-sm text-red-400 font-body mb-2">{error}</p>
            <button onClick={() => window.location.reload()}
              className="text-[11px] text-red-400/60 underline underline-offset-2 hover:text-red-400">
              Retry
            </button>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-12 text-center">
            <IconSignal className="w-8 h-8 mx-auto mb-3 text-white/15" />
            <p className="text-sm text-white/30 font-body">No active campaigns right now.</p>
            <p className="text-[11px] text-white/15 font-body mt-1">Check back soon.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 max-h-[calc(3.5*118px)] overflow-y-auto pr-0.5">
            {campaigns.map(c => (
              <CampaignCard key={c.slug} camp={c}
                selected={selected === c.slug}
                onClick={() => setSelected(c.slug)} />
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && !loadingList && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/[0.07] border border-red-500/20 text-sm text-red-400 font-body">
          {error}
        </div>
      )}

      {/* CTA */}
      <div className="animate-fade-up anim-d4">
        <button onClick={handleStart} disabled={!selected || starting || loadingList}
          className="btn-primary flex items-center justify-center gap-2.5">
          {starting ? (
            <><span className="w-4 h-4 rounded-full border-2 border-void/40 border-t-void animate-spin" />
            <span>Starting…</span></>
          ) : selected ? (
            <><span>{campaigns.find(c => c.slug === selected)?.name ?? selected}</span>
            <IconArrow className="w-4 h-4" /></>
          ) : 'Select a campaign above'}
        </button>
        <p className="text-center text-[9px] text-white/15 font-body mt-3">
          Continuing means you agree to our fair-use policy
        </p>
      </div>
    </div>
  );
}
