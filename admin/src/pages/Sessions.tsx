import { useEffect, useState, useCallback } from 'react';
import { api, Campaign, Session } from '../lib/api';

// ── Shared micro-components ────────────────────────────────────────────────

function Spin({ sm }: { sm?: boolean }) {
  const s = sm ? 'w-3.5 h-3.5' : 'w-6 h-6';
  return <div className={`${s} rounded-full border-2 border-accent-500 border-t-transparent animate-spin`} />;
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="panel p-14 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="text-white/40 font-body text-sm">{title}</p>
      {sub && <p className="text-white/20 font-body text-xs mt-1">{sub}</p>}
    </div>
  );
}

function ProgressBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px]
      font-display font-bold uppercase tracking-wide
      ${ok ? 'bg-accent-500/15 text-accent-400' : 'bg-white/[0.05] text-white/25'}`}>
      {ok ? '✓' : '·'} {label}
    </span>
  );
}

// ── Session status helpers ────────────────────────────────────────────────
//
// Status is determined by a combination of access_granted, expires_at, and
// granted_at — NOT by access_granted alone. The cleanup job zeroes
// access_granted after a session expires but preserves expires_at and
// granted_at, giving us enough information to tell sessions apart:
//
//   Active   — access_granted=1  AND expires_at > now
//   Expired  — access_granted=0  AND expires_at IS NOT NULL AND expires_at <= now
//              (was active, cleanup ran and revoked it)
//   Revoked  — access_granted=0  AND granted_at IS NOT NULL AND expires_at IS NULL
//              (admin manually revoked before natural expiry)
//   Pending  — access_granted=0  AND granted_at IS NULL
//              (user started portal flow but never completed video+survey+grant)

type SessionStatus = 'active' | 'expired' | 'revoked' | 'pending';

function getSessionStatus(s: Session): SessionStatus {
  const now = new Date();

  if (s.access_granted && s.expires_at && new Date(s.expires_at) > now) {
    return 'active';
  }
  if (!s.access_granted && s.expires_at && new Date(s.expires_at) <= now) {
    return 'expired';
  }
  if (!s.access_granted && s.granted_at && !s.expires_at) {
    // Granted in the past but expires_at was cleared — manual admin revoke
    return 'revoked';
  }
  // Never granted — user dropped out before completing the flow
  return 'pending';
}

function StatusBadge({ status }: { status: SessionStatus }) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px]
          font-display font-bold bg-accent-500/15 text-accent-400 border border-accent-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
          Active
        </span>
      );
    case 'expired':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
          font-display font-bold bg-white/[0.05] text-white/35 border border-white/[0.08]">
          Expired
        </span>
      );
    case 'revoked':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
          font-display font-bold bg-red-500/10 text-red-400/70 border border-red-500/20">
          Revoked
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
          font-display font-bold bg-amber-500/8 text-amber-400/50 border border-amber-500/15">
          Pending
        </span>
      );
  }
}

function ExpiryCell({ s, status }: { s: Session; status: SessionStatus }) {
  if (!s.expires_at) {
    if (status === 'pending') return <span className="text-white/20 text-xs">—</span>;
    if (status === 'revoked') return <span className="text-red-400/50 text-xs italic">revoked early</span>;
    return <span className="text-white/20 text-xs">—</span>;
  }
  const d    = new Date(s.expires_at);
  const past = d <= new Date();
  return (
    <span className={`text-xs whitespace-nowrap font-mono ${past ? 'text-white/30' : 'text-white/60'}`}>
      {d.toLocaleString()}
    </span>
  );
}

// ── Sessions page ──────────────────────────────────────────────────────────

type FilterStatus = '' | 'active' | 'expired' | 'revoked' | 'pending';

export function Sessions() {
  const [sessions,      setSessions]      = useState<Session[]>([]);
  const [campaigns,     setCampaigns]     = useState<Campaign[]>([]);
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterStatus,  setFilterStatus]  = useState<FilterStatus>('');
  const [loading,       setLoading]       = useState(true);
  const [revoking,      setRevoking]      = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        api.sessions({ limit: 200 }),
        api.campaigns(),
      ]);
      setSessions(s.sessions);
      setCampaigns(c);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  // Apply both filters
  const filtered = sessions.filter(s => {
    if (filterCampaign && s.campaign_id !== filterCampaign) return false;
    if (filterStatus   && getSessionStatus(s) !== filterStatus) return false;
    return true;
  });

  // Summary counts
  const counts = sessions.reduce((acc, s) => {
    acc[getSessionStatus(s)]++;
    return acc;
  }, { active: 0, expired: 0, revoked: 0, pending: 0 } as Record<SessionStatus, number>);

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this session? The user will lose internet access immediately.')) return;
    setRevoking(id);
    try {
      await api.revokeSession(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to revoke session');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-extrabold text-2xl text-white mb-0.5">Sessions</h2>
          <p className="text-sm text-white/35 font-body">All portal sessions and their status</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Status summary pills */}
          {(['active', 'expired', 'revoked', 'pending'] as FilterStatus[]).map(st => (
            <button
              key={st}
              onClick={() => setFilterStatus(f => f === st ? '' : st)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-display font-bold uppercase
                tracking-wider transition-all duration-150 border
                ${filterStatus === st
                  ? st === 'active'  ? 'bg-accent-500/20 border-accent-500/40 text-accent-400'
                  : st === 'expired' ? 'bg-white/10 border-white/20 text-white/60'
                  : st === 'revoked' ? 'bg-red-500/15 border-red-500/30 text-red-400'
                  :                   'bg-amber-500/10 border-amber-500/25 text-amber-400/70'
                  : 'bg-white/[0.03] border-white/[0.07] text-white/30 hover:text-white/50'
                }`}>
              {st} <span className="opacity-70 font-normal">({counts[st as SessionStatus]})</span>
            </button>
          ))}
          <select className="select text-sm py-1.5 w-44"
            value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}>
            <option value="">All campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={load} className="btn btn-surface btn-sm">⟳</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-16"><Spin /></div>
      ) : filtered.length === 0 ? (
        <Empty icon="📭"
          title={sessions.length === 0 ? 'No sessions yet' : 'No sessions match this filter'}
          sub={sessions.length === 0
            ? 'Sessions appear here as users connect to the portal'
            : 'Try clearing the filter to see all sessions'} />
      ) : (
        <div className="panel overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>MAC / IP</th>
                <th>Campaign</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Started</th>
                <th>Granted</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const status = getSessionStatus(s);
                return (
                  <tr key={s.id} className={status === 'active' ? 'bg-accent-500/[0.02]' : ''}>
                    <td>
                      <p className="font-mono text-[11px] text-white/70">{s.mac_address ?? '—'}</p>
                      <p className="font-mono text-[10px] text-white/30">{s.ip_address}</p>
                    </td>
                    <td className="text-white/60 text-xs">{s.campaign_name ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <ProgressBadge ok={!!s.video_watched}  label="Video" />
                        <ProgressBadge ok={!!s.survey_done}    label="Survey" />
                        <ProgressBadge ok={!!s.access_granted || !!s.granted_at} label="Granted" />
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={status} />
                    </td>
                    <td className="text-white/35 text-xs whitespace-nowrap">
                      {new Date(s.created_at).toLocaleString()}
                    </td>
                    <td className="text-white/35 text-xs whitespace-nowrap">
                      {s.granted_at
                        ? new Date(s.granted_at).toLocaleString()
                        : <span className="text-white/20">—</span>}
                    </td>
                    <td>
                      <ExpiryCell s={s} status={status} />
                    </td>
                    <td>
                      {status === 'active' && (
                        <button
                          onClick={() => handleRevoke(s.id)}
                          disabled={revoking === s.id}
                          className="btn btn-sm btn-danger"
                          title="Cut internet access immediately">
                          {revoking === s.id ? <Spin sm /> : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t border-white/[0.05] flex items-center gap-2">
            <p className="text-[10px] text-white/25 font-body">
              Showing {filtered.length} of {sessions.length} sessions
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Analytics page ─────────────────────────────────────────────────────────

type EngagementStats = {
  summary: {
    total_views: number; completed: number; dropped_off: number;
    still_watching: number; avg_watch_pct: number | null;
    avg_completion_pct: number | null; avg_drop_pct: number | null;
    completion_rate: number | null; drop_rate: number | null;
  };
  trend: Array<{ day: string; views: number; completed: number; dropped: number }>;
  dropBuckets:       Array<{ bucket: string; count: number }>;
  completionBuckets: Array<{ bucket: string; count: number }>;
};

// ── Mini bar chart row ─────────────────────────────────────────────────────
function BucketChart({
  buckets, color,
}: {
  buckets: Array<{ bucket: string; count: number }>;
  color: string;
}) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 1);
  if (buckets.length === 0)
    return <p className="text-xs text-white/20 font-body py-2">No data yet.</p>;
  return (
    <div className="space-y-2">
      {buckets.map(b => (
        <div key={b.bucket} className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-white/35 w-16 shrink-0">{b.bucket}</span>
          <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${color}`}
              style={{ width: `${(b.count / max) * 100}%` }} />
          </div>
          <span className="text-[10px] font-mono text-white/40 w-8 text-right shrink-0">
            {b.count}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 30-day trend bar chart ────────────────────────────────────────────────
function TrendChart({ trend }: { trend: EngagementStats['trend'] }) {
  if (trend.length === 0)
    return <p className="text-xs text-white/20 font-body py-4 text-center">No data in last 30 days.</p>;

  const maxViews = trend.reduce((m, r) => Math.max(m, r.views), 1);
  return (
    <div>
      <div className="flex items-end gap-1 h-24 mb-2">
        {trend.map((r, i) => (
          <div key={r.day}
            title={`${r.day}: ${r.views} views · ${r.completed} completed · ${r.dropped} dropped`}
            className="flex-1 flex flex-col justify-end relative group cursor-default">
            {/* Total views bar */}
            <div className="w-full rounded-t-sm bg-white/[0.08] relative overflow-hidden"
              style={{ height: `${Math.max((r.views / maxViews) * 88, r.views > 0 ? 3 : 0)}px` }}>
              {/* Completed fill from bottom */}
              <div className="absolute bottom-0 left-0 right-0 bg-accent-500/50 transition-all duration-500"
                style={{ height: `${r.views > 0 ? (r.completed / r.views) * 100 : 0}%` }} />
              {/* Drop-off fill on top of completed */}
              <div className="absolute bottom-0 left-0 right-0 bg-red-500/30 transition-all duration-500"
                style={{
                  height: `${r.views > 0 ? (r.dropped / r.views) * 100 : 0}%`,
                  bottom: `${r.views > 0 ? (r.completed / r.views) * 100 : 0}%`,
                }} />
            </div>
            {/* Date label every 5 bars */}
            {i % 5 === 0 && (
              <p className="text-[7px] font-mono text-white/15 text-center mt-1 whitespace-nowrap">
                {r.day.slice(5)}
              </p>
            )}
            {/* Tooltip on hover */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10
              hidden group-hover:flex flex-col items-center whitespace-nowrap
              bg-surface-900 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] shadow-lg">
              <span className="text-white/60 font-display font-bold mb-0.5">{r.day}</span>
              <span className="text-white/80">{r.views} views</span>
              <span className="text-accent-400">{r.completed} completed</span>
              {r.dropped > 0 && <span className="text-red-400">{r.dropped} dropped</span>}
            </div>
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex gap-4 justify-center">
        {[
          { color: 'bg-white/[0.15]',   label: 'Views' },
          { color: 'bg-accent-500/50',  label: 'Completed' },
          { color: 'bg-red-500/40',     label: 'Dropped' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
            <span className="text-[9px] text-white/30 font-body">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Video engagement section ──────────────────────────────────────────────
function VideoEngagementSection({
  campaigns,
}: {
  campaigns: Campaign[];
}) {
  const [selectedId, setSelectedId]   = useState<string>('');
  const [stats,      setStats]        = useState<EngagementStats | null>(null);
  const [loading,    setLoading]      = useState(false);
  const [engTab,     setEngTab]       = useState<'overview' | 'completion' | 'dropoff' | 'trend'>('overview');

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const r = await api.engagementStats(id);
      setStats(r.stats);
    } catch {}
    finally { setLoading(false); }
  }, []);

  // Auto-load first active campaign
  useEffect(() => {
    if (campaigns.length === 0) return;
    const first = campaigns.find(c => c.active === 1) ?? campaigns[0];
    setSelectedId(first.id);
    load(first.id);
  }, [campaigns]);

  const s = stats?.summary;

  const statPills = s ? [
    { label: 'Total Views',    value: s.total_views,                        color: 'text-white' },
    { label: 'Completed',      value: s.completed,                          color: 'text-accent-400' },
    { label: 'Dropped',        value: s.dropped_off,                        color: 'text-red-400' },
    { label: 'Completion Rate',value: s.completion_rate != null ? `${s.completion_rate}%` : '—', color: 'text-accent-400' },
    { label: 'Drop Rate',      value: s.drop_rate       != null ? `${s.drop_rate}%`       : '—', color: 'text-red-400' },
    { label: 'Avg Watch',      value: s.avg_watch_pct   != null ? `${s.avg_watch_pct}%`   : '—', color: 'text-white/70' },
    { label: 'Avg Completers', value: s.avg_completion_pct != null ? `${s.avg_completion_pct}%` : '—', color: 'text-accent-300' },
    { label: 'Avg Drop-off At',value: s.avg_drop_pct    != null ? `${s.avg_drop_pct}%`    : '—', color: 'text-amber-400' },
  ] : [];

  return (
    <div className="panel overflow-hidden">
      {/* Header + campaign selector */}
      <div className="panel-header">
        <div>
          <p className="font-display font-bold text-white">Video Engagement</p>
          <p className="text-[10px] text-white/30 font-body mt-0.5">
            Completions, drop-offs and watch depth per campaign
          </p>
        </div>
        <select
          className="select text-sm py-1.5 w-48"
          value={selectedId}
          onChange={e => { setSelectedId(e.target.value); load(e.target.value); }}>
          {campaigns.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="flex justify-center py-10"><Spin /></div>
        ) : !stats ? (
          <Empty icon="🎬" title="No video data yet"
            sub="Engagement data appears once users start watching videos" />
        ) : (
          <div className="space-y-5">

            {/* ── Stats grid ── */}
            <div className="grid grid-cols-4 gap-3">
              {statPills.map(({ label, value, color }) => (
                <div key={label} className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06] text-center">
                  <p className={`font-display font-bold text-xl ${color}`}>{value}</p>
                  <p className="text-[9px] text-white/25 font-body uppercase tracking-wider mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* ── Sub-tab nav ── */}
            <div className="flex gap-px border-b border-white/[0.05]">
              {([
                { id: 'overview',    label: '📊 Overview' },
                { id: 'completion',  label: '✅ Completers' },
                { id: 'dropoff',     label: '📉 Drop-offs' },
                { id: 'trend',       label: '📅 30-day trend' },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setEngTab(t.id)}
                  className={`px-4 py-2 text-[10px] font-display font-bold uppercase tracking-wider
                    border-b-2 transition-all duration-150
                    ${engTab === t.id
                      ? 'text-accent-400 border-accent-500'
                      : 'text-white/25 border-transparent hover:text-white/50'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Overview: side-by-side buckets ── */}
            {engTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-[10px] font-display font-bold uppercase tracking-widest
                    text-accent-400/70 mb-3">
                    ✅ Completion depth
                  </p>
                  <p className="text-[10px] text-white/25 font-body mb-3">
                    How far completers watched past the required threshold
                  </p>
                  <BucketChart
                    buckets={stats.completionBuckets}
                    color="bg-gradient-to-r from-accent-500/70 to-accent-400/40" />
                </div>
                <div>
                  <p className="text-[10px] font-display font-bold uppercase tracking-widest
                    text-red-400/70 mb-3">
                    📉 Drop-off points
                  </p>
                  <p className="text-[10px] text-white/25 font-body mb-3">
                    Where viewers quit before hitting the required threshold
                  </p>
                  <BucketChart
                    buckets={stats.dropBuckets}
                    color="bg-gradient-to-r from-red-500/60 to-amber-500/50" />
                </div>
              </div>
            )}

            {/* ── Completers tab ── */}
            {engTab === 'completion' && (
              <div>
                <p className="text-xs text-white/30 font-body mb-4">
                  Of the <strong className="text-white/70">{s?.completed ?? 0}</strong> viewers
                  who hit the required watch threshold, here's how far they actually went.
                  A high "97–100%" share means your video holds attention well past the minimum.
                </p>
                <BucketChart
                  buckets={stats.completionBuckets}
                  color="bg-gradient-to-r from-accent-500/70 to-accent-400/40" />
              </div>
            )}

            {/* ── Drop-offs tab ── */}
            {engTab === 'dropoff' && (
              <div>
                <p className="text-xs text-white/30 font-body mb-4">
                  Of the <strong className="text-white/70">{s?.dropped_off ?? 0}</strong> viewers
                  who left before completing, here's where they abandoned the video.
                  High counts in early buckets suggest the intro isn't engaging enough.
                </p>
                <BucketChart
                  buckets={stats.dropBuckets}
                  color="bg-gradient-to-r from-red-500/60 to-amber-500/50" />
              </div>
            )}

            {/* ── Trend tab ── */}
            {engTab === 'trend' && (
              <div>
                <p className="text-xs text-white/30 font-body mb-4">
                  Daily views, completions and drop-offs over the last 30 days.
                  Hover any bar for exact counts.
                </p>
                <TrendChart trend={stats.trend} />
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

// ── Survey results section ────────────────────────────────────────────────
function SurveyResultsSection({ campaigns }: { campaigns: Campaign[] }) {
  const [selected, setSelected] = useState('');
  const [data,     setData]     = useState<Record<string, {
    question: string; answers: Record<string, number>;
  }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (campaigns.length === 0) return;
    const first = campaigns.find(c => c.active === 1) ?? campaigns[0];
    setSelected(first.id);
  }, [campaigns]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    api.surveyResults(selected)
      .then(r => setData(r.aggregates))
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-header">
        <div>
          <p className="font-display font-bold text-white">Survey Results</p>
          <p className="text-[10px] text-white/30 font-body mt-0.5">
            Aggregated answers across all sessions for the selected campaign
          </p>
        </div>
        <select className="select text-sm py-1.5 w-48"
          value={selected} onChange={e => setSelected(e.target.value)}>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="flex justify-center py-10"><Spin /></div>
        ) : Object.keys(data).length === 0 ? (
          <Empty icon="📋" title="No survey responses yet"
            sub="Responses appear here once users complete the survey" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Object.entries(data).map(([qId, { question, answers }]) => {
              const total  = Object.values(answers).reduce((a, b) => a + b, 0);
              const sorted = Object.entries(answers).sort((a, b) => b[1] - a[1]);
              return (
                <div key={qId} className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4">
                  <p className="font-display font-semibold text-white text-sm leading-snug mb-1">
                    {question}
                  </p>
                  <p className="text-xs text-white/30 font-body mb-4">{total} responses</p>
                  <div className="space-y-3">
                    {sorted.map(([answer, count]) => {
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={answer}>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-white/65 font-body truncate mr-2">{answer}</span>
                            <span className="font-display font-bold text-accent-400 shrink-0">
                              {pct}%{' '}
                              <span className="text-white/25 font-normal">({count})</span>
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400 transition-all duration-700"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Analytics page ────────────────────────────────────────────────────
export function Analytics() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    api.campaigns()
      .then(setCampaigns)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Spin />
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="p-6">
        <Empty icon="📊" title="No campaigns yet"
          sub="Create a campaign to start seeing analytics" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="font-display font-extrabold text-2xl text-white mb-0.5">Analytics</h2>
        <p className="text-sm text-white/35 font-body">
          Video engagement, completion rates and survey responses by campaign
        </p>
      </div>

      <VideoEngagementSection campaigns={campaigns} />
      <SurveyResultsSection   campaigns={campaigns} />
    </div>
  );
}
