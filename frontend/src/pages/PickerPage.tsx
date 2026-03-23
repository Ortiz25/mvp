import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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

function CampaignCard({ camp, selected, onClick }: {
  camp: CampaignSummary; selected: boolean; onClick: () => void;
}) {
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
          {camp.require_video !== 0 && camp.video_filename && (
            <span className="chip chip-info gap-1">
              <IconPlay className="w-3 h-3" />
              Watch {watchPct}%
            </span>
          )}
          {camp.require_video === 0 && (
            <span className="chip chip-muted gap-1">
              <IconCheck className="w-3 h-3" />
              Survey only
            </span>
          )}
          {camp.require_survey !== 0 && camp.require_video !== 0 && (
            <span className="chip chip-muted gap-1">
              <IconCheck className="w-3 h-3" />
              + Survey
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
  const { hotspot, selectCampaign, refresh, status, selectedSlug, resolving } = usePortal();
  // Ref mirrors status so handleStart can read it synchronously after refresh()
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const navigate  = useNavigate();
  const location  = useLocation();

  // Notice passed from VideoPage when content is already consumed
  const notice: string | null = (location.state as any)?.notice ?? null;
  const dismissedSlug: string | null = (location.state as any)?.dismissedSlug ?? null;

  const [campaigns,        setCampaigns]        = useState<CampaignSummary[]>([]);
  const [selected,         setSelected]         = useState<string | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [starting,         setStarting]         = useState(false);

  useEffect(() => {
    listCampaigns()
      .then(c => { setCampaigns(c); if (c.length === 1) setSelected(c[0].slug); })
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false));
  }, []);

  // ── Returning user: whoAmI resolved a slug → auto-fetch status ────────
  // SessionContext sets selectedSlug after whoAmI identifies the user.
  // We watch for that change here and trigger a refresh, which will then
  // populate status.accessGranted — triggering the redirect below.
  useEffect(() => {
    // Only fetch status if whoAmI has fully resolved AND status wasn't
    // already set by the whoAmI flow (which now fetches status internally).
    if (selectedSlug && !status && !resolving && !loadingCampaigns) {
      console.log('[PickerPage] selectedSlug set but no status — fetching for slug:', selectedSlug);
      refresh();
    }
  }, [selectedSlug, resolving, status, loadingCampaigns]);

  // ── Redirect if already active ────────────────────────────────────────
  // Covers both returning users (detected via whoAmI) and users who
  // somehow land back on the picker after completing the flow.
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
    setStarting(false);

    if (statusRef.current?.accessGranted || statusRef.current?.active) {
      navigate('/connecting', { replace: true });
      return;
    }

    // Use the campaign list data (already loaded) to decide routing —
    // more reliable than statusRef which may not yet have requireVideo
    // populated if the /status response hasn't synced to the ref yet.
    const camp = campaigns.find(camp => camp.slug === selected);
    const requireVideo = camp ? camp.require_video !== 0 : true;
    navigate(requireVideo ? '/watch' : '/survey', { replace: true });
  };


  // ── Resolving state (whoAmI in flight) ────────────────────────────────
  // Show a brief spinner instead of the picker while we check if the user
  // has an active session. This prevents a flash of the picker UI before
  // the redirect to /connecting fires.
  if (resolving) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 px-5">
        <div className="w-8 h-8 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
        <p className="text-[12px] text-white/30 font-body">Checking your session…</p>
      </div>
    );
  }

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

      {/* Notice banner — shown when a campaign's content is already consumed */}
      {notice && (
        <div className="mb-4 px-4 py-3.5 rounded-xl border border-amber-500/25
          bg-amber-500/[0.06] animate-fade-up">
          <p className="text-[10px] font-display font-bold uppercase tracking-wider
            text-amber-400/70 mb-1">Content Already Viewed</p>
          <p className="text-[12px] text-amber-200/60 font-body leading-relaxed">
            {notice}
          </p>
        </div>
      )}

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
          {campaigns.filter(c => c.slug !== dismissedSlug).map(c => (
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


    </div>
  );
}