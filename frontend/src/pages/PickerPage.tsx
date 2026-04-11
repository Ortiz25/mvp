import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { listCampaigns, getRestrictions, RestrictionMap, CampaignSummary } from '../lib/api';
import { IconSignal, IconClock, IconPlay, IconCheck, IconArrow } from '../components/layout/Shell';

type Restriction = null | 'once_per_day' | 'once_ever';

function WifiArc({ strength = 3, muted = false }: { strength?: number; muted?: boolean }) {
  return (
    <svg viewBox="0 0 36 24" className="w-9 h-6" fill="none">
      {[0,1,2].map(i => (
        <path key={i}
          d={['M2 22 Q18 3 34 22','M6 18 Q18 7 30 18','M10.5 14 Q18 10 25.5 14'][i]}
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          opacity={muted ? 0.12 : i < strength ? 1 : 0.12}
        />
      ))}
      <circle cx="18" cy="22" r="2" fill="currentColor" opacity={muted ? 0.12 : 1} />
    </svg>
  );
}

function CampaignCard({ camp, selected, onClick, restriction }: {
  camp: CampaignSummary;
  selected: boolean;
  onClick: () => void;
  restriction: Restriction;
}) {
  const watchPct     = Math.round((camp.video_required_pct ?? 0.8) * 100);
  const isRestricted = restriction !== null;

  return (
    <button
      onClick={isRestricted ? undefined : onClick}
      disabled={isRestricted}
      className={[
        'campaign-card w-full text-left',
        isRestricted
          ? 'opacity-50 cursor-not-allowed pointer-events-none'
          : selected ? 'campaign-card-selected' : '',
      ].join(' ')}
    >
      {selected && !isRestricted && (
        <div className="h-[2px] bg-gradient-to-r from-signal to-aqua" />
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="min-w-0 flex-1">
            <h3 className={`font-display font-bold text-[15px] leading-tight truncate mb-0.5
              ${isRestricted ? 'text-white/40' : 'text-white'}`}>
              {camp.name}
            </h3>
            {camp.sponsor && (
              <p className="text-[10px] text-white/25 font-body">by {camp.sponsor}</p>
            )}
          </div>
          <div className={`shrink-0 transition-all duration-300
            ${isRestricted ? 'text-white/15' : selected ? 'text-signal' : 'text-white/20'}`}>
            <WifiArc strength={selected && !isRestricted ? 3 : 2} muted={isRestricted} />
          </div>
        </div>

        {isRestricted ? (
          <div className="mb-3">
            {restriction === 'once_per_day' && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl
                bg-amber-500/[0.08] border border-amber-500/20">
                <span className="text-base shrink-0 mt-0.5">⏰</span>
                <div>
                  <p className="text-[11px] font-display font-bold text-amber-400/80 leading-tight mb-0.5">
                    Already watched today
                  </p>
                  <p className="text-[10px] text-amber-200/50 font-body leading-relaxed">
                    Come back tomorrow for another free session.
                  </p>
                </div>
              </div>
            )}
            {restriction === 'once_ever' && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl
                bg-white/[0.04] border border-white/[0.08]">
                <span className="text-base shrink-0 mt-0.5">✅</span>
                <div>
                  <p className="text-[11px] font-display font-bold text-white/40 leading-tight mb-0.5">
                    Content already completed
                  </p>
                  <p className="text-[10px] text-white/25 font-body leading-relaxed">
                    You've already watched this campaign's content.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          camp.description && (
            <p className="text-[12px] text-white/40 font-body leading-relaxed mb-3 line-clamp-2">
              {camp.description}
            </p>
          )
        )}

        <div className={`flex flex-wrap gap-1.5 ${isRestricted ? 'opacity-40' : ''}`}>
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

      {selected && !isRestricted && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-signal/20 bg-signal/[0.04]">
          <IconCheck className="w-3.5 h-3.5 text-signal" />
          <span className="text-[11px] text-signal font-display font-bold">Selected</span>
        </div>
      )}
    </button>
  );
}

export function PickerPage() {
  const { hotspot, selectCampaign, refresh, status, setStatus, selectedSlug, resolving } = usePortal();
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const navigate = useNavigate();
  const location = useLocation();

  // dismissedSlug + dismissedFreq come from VideoPage when content is exhausted.
  // We render the card as restricted instead of hiding it.
  const dismissedSlug: string | null = (location.state as any)?.dismissedSlug ?? null;
  const dismissedFreq: string | null = (location.state as any)?.dismissedFreq ?? null;

  const [campaigns,        setCampaigns]        = useState<CampaignSummary[]>([]);
  const [selected,         setSelected]         = useState<string | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [starting,         setStarting]         = useState(false);
  // DB-sourced per-campaign restrictions for this MAC. Decoupled from
  // location.state so they survive page reload and CoovaChilli redirects.
  const [apiRestrictions,  setApiRestrictions]  = useState<RestrictionMap>({});

  const getRestriction = (camp: CampaignSummary): Restriction => {
    // ── Tier 1: DB-sourced restrictions (most reliable) ────────────────────
    // Fetched fresh from /api/restrictions on mount. Survives page reload,
    // CoovaChilli redirects, and back-navigation — unlike location.state which
    // only exists when VideoPage explicitly navigated here.
    if (apiRestrictions[camp.slug]) {
      return apiRestrictions[camp.slug] as Restriction;
    }

    // ── Tier 2: VideoPage dismissal via location.state ─────────────────────
    // Used as a fast/optimistic signal immediately after VideoPage navigates
    // back here with dismissedSlug — before apiRestrictions has been refreshed.
    if (camp.slug === dismissedSlug) {
      if (dismissedFreq === 'once_per_day') return 'once_per_day';
      if (dismissedFreq === 'once_ever')    return 'once_ever';
      if (camp.watch_frequency === 'once_per_day') return 'once_per_day';
      if (camp.watch_frequency === 'once_ever')    return 'once_ever';
    }

    return null;
  };

  useEffect(() => {
    listCampaigns()
      .then(c => {
        setCampaigns(c);
        // Auto-select first unrestricted campaign when only one is available
        const free = c.filter(camp => {
          if (camp.slug !== dismissedSlug) return true;
          return false;
        });
        if (free.length === 1)   setSelected(free[0].slug);
        else if (c.length === 1) setSelected(c[0].slug);
      })
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false));
  }, []);

  // Fetch per-campaign restrictions from the DB whenever the MAC is resolved.
  // Runs on mount (if MAC came from URL params / sessionStorage) and again if
  // whoAmI resolves the MAC later. Falls back to {} silently on error.
  useEffect(() => {
    if (!hotspot.mac && !hotspot.ip) return;
    getRestrictions(hotspot.mac, hotspot.ip).then(setApiRestrictions);
  }, [hotspot.mac]);

  useEffect(() => {
    if (selectedSlug && !status && !resolving && !loadingCampaigns) {
      refresh();
    }
  }, [selectedSlug, resolving, status, loadingCampaigns]);

  useEffect(() => {
    if (!status) return;
    if (status.active) {
      navigate('/connecting', { replace: true });
      return;
    }
    // Restrictions are now sourced from apiRestrictions (DB), not from status.
    // Always clear status so PickerPage starts clean — restriction display is
    // handled independently by getRestriction() via the API map.
    setStatus(null);
  }, [status]);

  const selectedCamp     = campaigns.find(c => c.slug === selected);
  const selectedRestrict = selectedCamp ? getRestriction(selectedCamp) : null;
  const allRestricted    = campaigns.length > 0 && campaigns.every(c => getRestriction(c) !== null);

  const handleStart = async () => {
    if (!selected || starting || selectedRestrict !== null) return;
    setStarting(true);
    selectCampaign(selected);
    await refresh();
    setStarting(false);

    if (statusRef.current?.active) {
      navigate('/connecting', { replace: true });
      return;
    }

    const camp = campaigns.find(c => c.slug === selected);
    const requireVideo = camp ? camp.require_video !== 0 : true;
    navigate(requireVideo ? '/watch' : '/survey', { replace: true });
  };

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
              onClick={() => !getRestriction(c) && setSelected(c.slug)}
              restriction={getRestriction(c)}
            />
          ))}
        </div>
      )}

      <button
        onClick={handleStart}
        disabled={!selected || starting || selectedRestrict !== null || allRestricted}
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
