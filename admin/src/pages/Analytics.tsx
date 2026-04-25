import { useEffect, useState, useCallback } from 'react';
import { api, Campaign } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

type EngagementStats = {
  summary: {
    total_views:        number;
    completed:          number;
    dropped_off:        number;
    still_watching:     number;
    bounce_count?:       number;
    avg_watch_pct:      number | null;
    avg_completion_pct: number | null;
    avg_drop_pct:       number | null;
    completion_rate:    number | null;
    drop_rate:          number | null;
    bounce_rate?:        number | null;
  };
  trend: Array<{ day: string; views: number; completed: number; dropped: number }>;
  dropBuckets:       Array<{ bucket: string; count: number }>;
  completionBuckets: Array<{ bucket: string; count: number }>;
};

type SurveyData = Record<string, { question: string; answers: Record<string, number> }>;

// ── Icons ──────────────────────────────────────────────────────────────────

type IP = { className?: string };
const IconBarChart2  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>;
const IconClipboard  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>;
const IconTrendUp    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/><polyline points="17,6 23,6 23,12"/></svg>;
const IconTrendDown  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,18 13.5,8.5 8.5,13.5 1,6"/><polyline points="17,18 23,18 23,12"/></svg>;
const IconEye        = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const IconCheckCircle= ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>;
const IconXCircle    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
const IconRefresh    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;

// ── Shared micro-components ────────────────────────────────────────────────

function Spin({ sm }: { sm?: boolean }) {
  const s = sm ? 'w-3.5 h-3.5' : 'w-7 h-7';
  return <div className={`${s} rounded-full border-2 border-accent-500 border-t-transparent animate-spin`} />;
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="text-4xl opacity-40">{icon}</div>
      <p className="text-theme-muted font-body text-sm">{title}</p>
      {sub && <p className="text-theme-faint font-body text-xs">{sub}</p>}
    </div>
  );
}

// ── Campaign selector ──────────────────────────────────────────────────────

function CampaignSelector({
  campaigns,
  value,
  onChange,
}: {
  campaigns: Campaign[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (campaigns.length === 0) return null;
  return (
    <select
      className="select text-sm py-1.5 min-w-[11rem]"
      value={value}
      onChange={e => onChange(e.target.value)}>
      {campaigns.map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

// ── Stat pill ──────────────────────────────────────────────────────────────

function StatPill({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.FC<{ className?: string }>;
  accent?: 'green' | 'red' | 'amber' | 'blue' | 'default';
}) {
  const colors = {
    green:   'text-accent-400',
    red:     'text-red-400',
    amber:   'text-amber-400',
    blue:    'text-info-400',
    default: 'text-theme-primary',
  };
  const iconBg = {
    green:   'bg-accent-500/10 text-accent-400',
    red:     'bg-red-500/10 text-red-400',
    amber:   'bg-amber-500/10 text-amber-400',
    blue:    'bg-info-500/10 text-info-400',
    default: 'bg-theme-input text-theme-muted',
  };
  const col  = colors[accent ?? 'default'];
  const ibg  = iconBg[accent ?? 'default'];
  return (
    <div className="bg-theme-input rounded-2xl p-4 border border-theme-subtle flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-display font-bold uppercase tracking-[0.15em] text-theme-faint">
          {label}
        </p>
        {Icon && (
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${ibg}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
      <p className={`font-display font-black text-2xl leading-none tracking-tight ${col}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-theme-faint font-body">{sub}</p>}
    </div>
  );
}

// ── Horizontal bar chart ───────────────────────────────────────────────────

function BucketChart({
  buckets,
  colorClass,
  emptyMsg = 'No data yet.',
}: {
  buckets: Array<{ bucket: string; count: number }>;
  colorClass: string;
  emptyMsg?: string;
}) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 1);
  if (buckets.length === 0)
    return <p className="text-xs text-theme-faint font-body py-4 text-center">{emptyMsg}</p>;
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div className="space-y-3">
      {buckets.map(b => {
        const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
        return (
          <div key={b.bucket} className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-theme-muted w-16 shrink-0 text-right">
              {b.bucket}
            </span>
            <div className="flex-1 h-2.5 rounded-full bg-theme-input overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${colorClass}`}
                style={{ width: `${(b.count / max) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0 w-20">
              <span className="text-[11px] font-display font-bold text-theme-secondary w-8 text-right">
                {b.count}
              </span>
              <span className="text-[10px] text-theme-faint font-body">
                {pct}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 30-day trend chart ─────────────────────────────────────────────────────

function TrendChart({ trend }: { trend: EngagementStats['trend'] }) {
  if (trend.length === 0)
    return <Empty icon="📅" title="No data in last 30 days" />;

  const maxViews = trend.reduce((m, r) => Math.max(m, r.views), 1);

  return (
    <div>
      <div className="flex items-end gap-[3px] h-28 mb-3">
        {trend.map((r, i) => (
          <div
            key={r.day}
            title={`${r.day}: ${r.views} views · ${r.completed} completed · ${r.dropped} dropped`}
            className="flex-1 flex flex-col justify-end relative group cursor-default">
            <div
              className="w-full rounded-t bg-white/[0.07] relative overflow-hidden"
              style={{ height: `${Math.max((r.views / maxViews) * 104, r.views > 0 ? 4 : 0)}px` }}>
              {/* completed */}
              <div
                className="absolute bottom-0 left-0 right-0 bg-accent-500/55 transition-all duration-500"
                style={{ height: `${r.views > 0 ? (r.completed / r.views) * 100 : 0}%` }}
              />
              {/* dropped — stacked above completed */}
              <div
                className="absolute left-0 right-0 bg-red-500/40 transition-all duration-500"
                style={{
                  height: `${r.views > 0 ? (r.dropped / r.views) * 100 : 0}%`,
                  bottom: `${r.views > 0 ? (r.completed / r.views) * 100 : 0}%`,
                }}
              />
            </div>
            {i % 5 === 0 && (
              <p className="text-[7px] font-mono text-theme-faint text-center mt-1 whitespace-nowrap">
                {r.day.slice(5)}
              </p>
            )}
            {/* hover tooltip */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20
              hidden group-hover:flex flex-col items-center whitespace-nowrap pointer-events-none
              bg-surface-800 border border-theme-input rounded-xl px-3 py-2 text-[9px] shadow-xl gap-0.5">
              <span className="text-theme-muted font-display font-bold mb-1">{r.day}</span>
              <span className="text-theme-secondary">{r.views} views</span>
              <span className="text-accent-400">{r.completed} completed</span>
              {r.dropped > 0 && <span className="text-red-400">{r.dropped} dropped</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-5 justify-center">
        {[
          { color: 'bg-white/[0.12]',  label: 'Views' },
          { color: 'bg-accent-500/55', label: 'Completed' },
          { color: 'bg-red-500/40',    label: 'Dropped' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
            <span className="text-[9px] text-theme-faint font-body">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Survey answer bar ──────────────────────────────────────────────────────

function SurveyAnswerBar({ answer, count, total }: { answer: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-xs text-theme-secondary font-body truncate">{answer}</span>
        <span className="text-xs font-display font-bold text-accent-400 shrink-0">
          {pct}%
          <span className="text-theme-faint font-normal ml-1">({count})</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-theme-input overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ── VIDEO ENGAGEMENT TAB ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════

type VideoSubTab = 'overview' | 'completion' | 'dropoff' | 'trend';

function VideoEngagementTab({ campaigns }: { campaigns: Campaign[] }) {
  const [campaignId, setCampaignId] = useState('');
  const [stats,      setStats]      = useState<EngagementStats | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [subTab,     setSubTab]     = useState<VideoSubTab>('overview');

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setStats(null);
    try {
      const r = await api.engagementStats(id);
      setStats(r.stats);
    } catch { /* will show empty state */ }
    finally { setLoading(false); }
  }, []);

  // Auto-load first active campaign on mount
  useEffect(() => {
    if (campaigns.length === 0) return;
    const first = campaigns.find(c => c.active === 1) ?? campaigns[0];
    setCampaignId(first.id);
    load(first.id);
  }, [campaigns]);

  const handleCampaignChange = (id: string) => {
    setCampaignId(id);
    load(id);
  };

  const s = stats?.summary;

  const SUB_TABS: { id: VideoSubTab; label: string; icon: string }[] = [
    { id: 'overview',   label: 'Overview',    icon: '📊' },
    { id: 'completion', label: 'Completers',  icon: '✅' },
    { id: 'dropoff',    label: 'Drop-offs',   icon: '📉' },
    { id: 'trend',      label: '30-day trend',icon: '📅' },
  ];

  return (
    <div className="space-y-5">

      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display font-bold text-theme-primary text-lg">Video Engagement</h3>
          <p className="text-xs text-theme-muted font-body mt-0.5">
            Watch depth, completions and drop-off analysis per campaign
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(campaignId)}
            disabled={loading || !campaignId}
            className="btn btn-surface btn-sm">
            <IconRefresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <CampaignSelector
            campaigns={campaigns}
            value={campaignId}
            onChange={handleCampaignChange}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spin /></div>
      ) : !stats ? (
        <Empty icon="🎬" title="No video data yet"
          sub="Engagement data appears once users start watching videos" />
      ) : (
        <>
          {/* ── Stats grid ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
            <StatPill
              label="Total Views"
              value={s!.total_views}
              sub="all time"
              icon={IconEye}
              accent="default"
            />
            <StatPill
              label="Completed"
              value={s!.completed}
              sub={s!.completion_rate != null ? `${s!.completion_rate}% rate` : undefined}
              icon={IconCheckCircle}
              accent="green"
            />
            <StatPill
              label="Dropped Off"
              value={s!.dropped_off}
              sub={s!.drop_rate != null ? `${s!.drop_rate}% rate` : undefined}
              icon={IconXCircle}
              accent="red"
            />
            <StatPill
              label="Bounced"
              value={s!.bounce_count ?? 0}
              sub={s!.bounce_rate != null ? `${s!.bounce_rate}% bounce rate` : undefined}
              icon={IconTrendDown}
              accent="amber"
            />
          </div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
            <StatPill
              label="Avg Watch"
              value={s!.avg_watch_pct != null ? `${s!.avg_watch_pct}%` : '—'}
              sub="across all views"
              accent="default"
            />
            <StatPill
              label="Avg Completers"
              value={s!.avg_completion_pct != null ? `${s!.avg_completion_pct}%` : '—'}
              sub="how far completers went"
              accent="green"
            />
            <StatPill
              label="Avg Drop-off At"
              value={s!.avg_drop_pct != null ? `${s!.avg_drop_pct}%` : '—'}
              sub="where people quit"
              accent="red"
            />
            <StatPill
              label="Still Watching"
              value={s!.still_watching ?? 0}
              sub="in-progress right now"
              accent="blue"
            />
          </div>

          {/* ── Sub-tab nav ── */}
          <div className="flex gap-px border-b border-theme-subtle">
            {SUB_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-[10px] font-display
                  font-bold uppercase tracking-wider border-b-2 transition-all duration-150
                  ${subTab === t.id
                    ? 'text-accent-400 border-accent-500'
                    : 'text-theme-faint border-transparent hover:text-theme-muted hover:border-theme-input'
                  }`}>
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* ── Overview: completion depth + drop-off side-by-side ── */}
          {subTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="panel p-5">
                <p className="text-[10px] font-display font-bold uppercase tracking-widest
                  text-accent-400/80 mb-1">
                  ✅ Completion depth
                </p>
                <p className="text-[10px] text-theme-faint font-body mb-4 leading-relaxed">
                  How far completers watched past the required threshold.
                  A high "97–100%" share means your video holds attention well past the minimum.
                </p>
                <BucketChart
                  buckets={stats.completionBuckets}
                  colorClass="bg-gradient-to-r from-accent-500/80 to-cyan-400/60"
                  emptyMsg="No completions recorded yet."
                />
              </div>
              <div className="panel p-5">
                <p className="text-[10px] font-display font-bold uppercase tracking-widest
                  text-red-400/80 mb-1">
                  📉 Drop-off points
                </p>
                <p className="text-[10px] text-theme-faint font-body mb-4 leading-relaxed">
                  Where viewers quit before hitting the required threshold.
                  High counts in early buckets suggest the intro isn't engaging enough.
                </p>
                <BucketChart
                  buckets={stats.dropBuckets}
                  colorClass="bg-gradient-to-r from-red-500/70 to-amber-400/60"
                  emptyMsg="No drop-offs recorded yet."
                />
              </div>
            </div>
          )}

          {/* ── Completers detail ── */}
          {subTab === 'completion' && (
            <div className="panel p-5">
              <div className="flex items-start gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-accent-500/10 border border-accent-500/20
                  flex items-center justify-center shrink-0">
                  <IconCheckCircle className="w-4.5 h-4.5 text-accent-400" />
                </div>
                <div>
                  <p className="font-display font-bold text-theme-primary">
                    {s!.completed} viewers completed
                  </p>
                  <p className="text-xs text-theme-muted font-body mt-0.5">
                    Here's how far they watched past the required threshold.
                    A high share in the "97–100%" bucket means your content holds attention
                    well after the gate.
                  </p>
                </div>
              </div>
              <BucketChart
                buckets={stats.completionBuckets}
                colorClass="bg-gradient-to-r from-accent-500/80 to-cyan-400/60"
                emptyMsg="No completions recorded yet."
              />
            </div>
          )}

          {/* ── Drop-off detail ── */}
          {subTab === 'dropoff' && (
            <div className="panel p-5">
              <div className="flex items-start gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20
                  flex items-center justify-center shrink-0">
                  <IconXCircle className="w-4.5 h-4.5 text-red-400" />
                </div>
                <div>
                  <p className="font-display font-bold text-theme-primary">
                    {s!.dropped_off} viewers dropped off
                  </p>
                  <p className="text-xs text-theme-muted font-body mt-0.5">
                    Where they quit before completing the required watch threshold.
                    Spikes in the "0–10%" bucket mean people are bouncing from the intro;
                    spikes near "75–90%" suggest they're close but losing interest near the end.
                  </p>
                </div>
              </div>
              <BucketChart
                buckets={stats.dropBuckets}
                colorClass="bg-gradient-to-r from-red-500/70 to-amber-400/60"
                emptyMsg="No drop-offs recorded yet."
              />
            </div>
          )}

          {/* ── 30-day trend ── */}
          {subTab === 'trend' && (
            <div className="panel p-5">
              <div className="flex items-start gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-info-500/10 border border-info-500/20
                  flex items-center justify-center shrink-0">
                  <IconTrendUp className="w-4.5 h-4.5 text-info-400" />
                </div>
                <div>
                  <p className="font-display font-bold text-theme-primary">Daily activity — last 30 days</p>
                  <p className="text-xs text-theme-muted font-body mt-0.5">
                    Hover any bar for exact counts. Taller bars are more views;
                    green fill is completions, red is drop-offs.
                  </p>
                </div>
              </div>
              <TrendChart trend={stats.trend} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ── SURVEY RESULTS TAB ───────────────────────────────────════════════════
// ══════════════════════════════════════════════════════════════════════════

function SurveyResultsTab({ campaigns }: { campaigns: Campaign[] }) {
  const [campaignId, setCampaignId] = useState('');
  const [data,       setData]       = useState<SurveyData>({});
  const [loading,    setLoading]    = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setData({});
    try {
      const r = await api.surveyResults(id);
      setData(r.aggregates);
    } catch { /* empty state */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (campaigns.length === 0) return;
    const first = campaigns.find(c => c.active === 1) ?? campaigns[0];
    setCampaignId(first.id);
    load(first.id);
  }, [campaigns]);

  const handleCampaignChange = (id: string) => {
    setCampaignId(id);
    load(id);
  };

  const questions = Object.entries(data);
  const totalResponses = questions.length > 0
    ? Object.values(Object.values(data)[0]?.answers ?? {}).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="space-y-5">

      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display font-bold text-theme-primary text-lg">Survey Results</h3>
          <p className="text-xs text-theme-muted font-body mt-0.5">
            Aggregated responses across all sessions for the selected campaign
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(campaignId)}
            disabled={loading || !campaignId}
            className="btn btn-surface btn-sm">
            <IconRefresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <CampaignSelector
            campaigns={campaigns}
            value={campaignId}
            onChange={handleCampaignChange}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spin /></div>
      ) : questions.length === 0 ? (
        <Empty
          icon="📋"
          title="No survey responses yet"
          sub="Responses appear here once users complete the survey for this campaign"
        />
      ) : (
        <>
          {/* Summary pill */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl
            bg-accent-500/[0.06] border border-accent-500/15">
            <IconClipboard className="w-4 h-4 text-accent-400 shrink-0" />
            <p className="text-xs text-theme-muted font-body">
              <span className="font-display font-bold text-accent-400">{totalResponses}</span>
              {' '}total responses across{' '}
              <span className="font-display font-bold text-theme-secondary">{questions.length}</span>
              {' '}question{questions.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Question cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {questions.map(([qId, { question, answers }], qi) => {
              const total  = Object.values(answers).reduce((a, b) => a + b, 0);
              const sorted = Object.entries(answers).sort((a, b) => b[1] - a[1]);
              const winner = sorted[0]?.[0];
              return (
                <div key={qId}
                  className="panel p-5 flex flex-col gap-4">
                  {/* Question header */}
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-accent-500/15 text-accent-400
                      text-[10px] font-display font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {qi + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-theme-primary text-sm leading-snug">
                        {question}
                      </p>
                      <p className="text-[10px] text-theme-faint font-body mt-0.5">
                        {total} response{total !== 1 ? 's' : ''}
                        {winner && (
                          <> · top answer: <span className="text-theme-muted">{winner}</span></>
                        )}
                      </p>
                    </div>
                  </div>
                  {/* Answer bars */}
                  <div className="space-y-3">
                    {sorted.map(([answer, count]) => (
                      <SurveyAnswerBar
                        key={answer}
                        answer={answer}
                        count={count}
                        total={total}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ── MAIN ANALYTICS PAGE ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════

type MainTab = 'video' | 'survey';

export function Analytics() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [mainTab,   setMainTab]   = useState<MainTab>('video');

  useEffect(() => {
    api.campaigns()
      .then(setCampaigns)
      .finally(() => setLoading(false));
  }, []);

  const MAIN_TABS: { id: MainTab; label: string; Icon: React.FC<{ className?: string }>; desc: string }[] = [
    {
      id:    'video',
      label: 'Video Engagement',
      Icon:  IconBarChart2,
      desc:  'Watch depth, completions & drop-offs',
    },
    {
      id:    'survey',
      label: 'Survey Results',
      Icon:  IconClipboard,
      desc:  'Aggregated question responses',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Spin />
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <div className="panel p-14 text-center">
          <div className="text-5xl mb-4 opacity-40">📊</div>
          <p className="font-display font-bold text-theme-primary text-lg mb-2">No campaigns yet</p>
          <p className="text-sm text-theme-muted font-body">
            Create a campaign to start seeing analytics
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pb-24 lg:pb-6 space-y-4 md:space-y-6">

      {/* ── Page title ── */}
      <div>
        <h2 className="font-display font-extrabold text-xl md:text-2xl text-theme-primary mb-0.5">Analytics</h2>
        <p className="text-sm text-theme-muted font-body">
          Video engagement, completion rates and survey responses by campaign
        </p>
      </div>

      {/* ── Top-level tab switcher ── */}
      <div className="flex gap-2 md:gap-3 overflow-x-auto pb-1 -mx-4 md:mx-0 px-4 md:px-0 snap-x">
        {MAIN_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setMainTab(t.id)}
            className={`flex items-center gap-2 md:gap-3 px-3 md:px-5 py-2.5 md:py-3.5 rounded-2xl border
              font-display font-semibold text-sm transition-all duration-150 shrink-0 snap-start
              ${mainTab === t.id
                ? 'bg-accent-500/10 border-accent-500/30 text-theme-primary'
                : 'bg-white/[0.02] border-theme-subtle text-theme-muted hover:text-theme-secondary hover:bg-theme-input'
              }`}>
            <div className={`w-7 h-7 md:w-8 md:h-8 rounded-xl flex items-center justify-center transition-colors
              ${mainTab === t.id
                ? 'bg-accent-500/15 text-accent-400'
                : 'bg-theme-input text-theme-faint'
              }`}>
              <t.Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </div>
            <div className="text-left">
              <p className="leading-tight text-xs md:text-sm">{t.label}</p>
              <p className={`text-[9px] font-body font-normal mt-0.5 leading-tight hidden md:block
                ${mainTab === t.id ? 'text-theme-muted' : 'text-theme-faint'}`}>
                {t.desc}
              </p>
            </div>
            {mainTab === t.id && (
              <div className="w-1.5 h-1.5 rounded-full bg-accent-400 ml-1 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div>
        {mainTab === 'video'  && <VideoEngagementTab  campaigns={campaigns} />}
        {mainTab === 'survey' && <SurveyResultsTab    campaigns={campaigns} />}
      </div>

    </div>
  );
}
