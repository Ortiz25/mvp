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
  const [search,        setSearch]        = useState('');
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

  // Apply all filters
  const q = search.trim().toLowerCase();
  const filtered = sessions.filter(s => {
    if (filterCampaign && s.campaign_id !== filterCampaign) return false;
    if (filterStatus   && getSessionStatus(s) !== filterStatus) return false;
    if (q) {
      const mac      = (s.mac_address  ?? '').toLowerCase();
      const ip       = (s.ip_address   ?? '').toLowerCase();
      const campaign = (s.campaign_name ?? '').toLowerCase();
      if (!mac.includes(q) && !ip.includes(q) && !campaign.includes(q)) return false;
    }
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
    <div className="p-4 md:p-6 pb-24 lg:pb-6">
      <div className="flex items-start justify-between mb-4 md:mb-5 gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-extrabold text-xl md:text-2xl text-white mb-0.5">Sessions</h2>
          <p className="text-sm text-white/35 font-body">All portal sessions and their status</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center w-full md:w-auto">
          {/* Search box */}
          <div className="relative w-full md:w-auto">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search MAC, IP or campaign…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="select text-sm py-1.5 pl-8 pr-3 w-full md:w-56 placeholder:text-white/20"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                ✕
              </button>
            )}
          </div>
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
          <select className="select text-sm py-1.5 w-full md:w-44"
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
            : 'Try clearing the search or filters to see all sessions'} />
      ) : (
        <div className="panel overflow-hidden">
          <div className="tbl-wrap">
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
          </div>
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
