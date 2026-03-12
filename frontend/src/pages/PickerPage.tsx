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
          <div className={`shrink-0 transition-all duration-300 ${selected ? 'text-signal' : 'text-white/20'}`}>
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
        </div>
      </div>
      {selected && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-signal/20 bg-signal/[0.04]">
          <IconCheck className="w-3.5 h-3.5 text-signal" />
          <span className="text-[11px] text-signal font-display font-bold">Selected</span>
        </div>
      )}
    </button>
  );
}

export function PickerPage() {
  const { hotspot, selectCampaign, refresh, status } = usePortal();
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [starting,  setStarting]  = useState(false);

  useEffect(() => {
    listCampaigns()
      .then(c => { setCampaigns(c); if (c.length === 1) setSelected(c[0].slug); })
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false));
  }, []);

  // If server says already active → go straight to connecting
  useEffect(() => {
    if (status?.active || status?.accessGranted) {
      navigate('/connecting', { replace: true });
    }
  }, [status]);

  const handleStart = async () => {
    if (!selected || starting) return;
    setStarting(true);
    selectCampaign(selected);
    await refresh();
    // refresh() sets status — the useEffect above will handle routing
    // But also check directly in case the effect fires too late
    setStarting(false);
    navigate('/watch', { replace: true });
  };

  // Debug section — visible when mac is missing
  const debugVisible = !hotspot.mac;

  return (
    <div className="px-5 py-5">
      {/* Header */}
      <div className="mb-6 animate-fade-up">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-lg bg-signal/10 border border-signal/20 flex items-center justify-center">
            <IconSignal className="w-4 h-4 text-signal" />
          </div>
          <span className="font-display font-bold text-sm text-white/60 tracking-wide">CityNet</span>
        </div>
        <h1 className="font-display font-extrabold text-[26px] text-white leading-tight tracking-tight mb-1.5">
          Free Internet<br />Access
        </h1>
        <p className="text-sm text-white/40 font-body leading-relaxed">
          {hotspot.mac
            ? `Device: ${hotspot.mac}`
            : 'Choose a campaign to get started'}
        </p>
      </div>

      {/* Campaign list */}
      {loadingCampaigns ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-white/30 font-body text-sm">No campaigns available right now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-5 animate-fade-up anim-d1">
          {campaigns.map(c => (
            <CampaignCard
              key={c.slug}
              camp={c}
              selected={selected === c.slug}
              onClick={() => setSelected(c.slug)}
            />
          ))}
        </div>
      )}

      {/* Start button */}
      <button
        onClick={handleStart}
        disabled={!selected || starting}
        className="btn-primary flex items-center justify-center gap-2.5 animate-fade-up anim-d2">
        {starting ? (
          <>
            <span className="w-4 h-4 rounded-full border-2 border-void/40 border-t-void animate-spin" />
            <span>Starting…</span>
          </>
        ) : (
          <>
            <span>Get Started</span>
            <IconArrow className="w-4 h-4" />
          </>
        )}
      </button>

      {/* Debug panel — only shows when mac is missing */}
      {debugVisible && (
        <div className="mt-6 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.04] px-4 py-3">
          <p className="text-[10px] font-display font-bold text-yellow-400/60 uppercase tracking-wider mb-1.5">
            Setup Required
          </p>
          <p className="text-[11px] text-yellow-300/50 font-body leading-relaxed">
            No MAC address detected. This means the MikroTik login.html is not
            redirecting to captive.local with <code className="text-yellow-200/60">?mac=</code> params.
          </p>
          <p className="text-[11px] text-yellow-300/30 font-body mt-1.5">
            Check: flash/hotspot/login.html on your MikroTik router.
          </p>
        </div>
      )}
    </div>
  );
}
