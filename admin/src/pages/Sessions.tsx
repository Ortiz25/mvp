// src/pages/Sessions.tsx
import { useEffect, useState } from 'react';
import { api, Session, Campaign, RevokeResult } from '../lib/api';

// ── Icons ──────────────────────────────────────────────────────────────────
type IP = { className?: string };
const IconRefresh  = ({ className = 'w-4 h-4' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const IconTrash    = ({ className = 'w-4 h-4' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
const IconExternal = ({ className = 'w-4 h-4' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
const IconX        = ({ className = 'w-4 h-4' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconCheck    = ({ className = 'w-4 h-4' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>;

function ProgressBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
      font-display font-bold border
      ${ok
        ? 'bg-accent-500/10 text-accent-400 border-accent-500/25'
        : 'bg-white/[0.04] text-white/20 border-white/[0.06]'}`}>
      {ok
        ? <IconCheck className="w-2.5 h-2.5" />
        : <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
      }
      {label}
    </span>
  );
}

export function Sessions() {
  const [sessions,   setSessions]   = useState<Session[]>([]);
  const [campaigns,  setCampaigns]  = useState<Campaign[]>([]);
  const [filter,     setFilter]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [revoking,   setRevoking]   = useState<string | null>(null);
  const [revokeInfo, setRevokeInfo] = useState<RevokeResult | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        api.sessions({ limit: 100, campaign: filter || undefined }),
        api.campaigns(),
      ]);
      setSessions(s.sessions);
      setCampaigns(c);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const revoke = async (id: string) => {
    if (!confirm(
      'Revoke this session in the database?\n\n' +
      'Note: The MikroTik Hotspot session will expire on its own, or you can ' +
      'visit the logout URL shown after revoking.'
    )) return;
    setRevoking(id);
    try {
      const result = await api.revokeSession(id);
      setRevokeInfo(result);
      await load();
    } finally { setRevoking(null); }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-display font-extrabold text-2xl text-white mb-0.5">Sessions</h2>
          <p className="text-sm text-white/35 font-body">All client portal sessions</p>
        </div>
        <div className="flex gap-3">
          <select className="select w-44 text-sm py-2"
            value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All campaigns</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={load}
            className="btn btn-surface btn-sm flex items-center gap-1.5">
            <IconRefresh className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Hotspot revoke banner */}
      {revokeInfo && (
        <div className="mb-4 p-4 rounded-xl border border-warning-500/25 bg-warning-500/[0.06]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-display font-bold text-warning-400 mb-1">
                Session revoked in database
              </p>
              <p className="text-xs text-white/40 font-body mb-2 leading-relaxed">
                {revokeInfo.note}
              </p>
              {revokeInfo.logoutUrl && revokeInfo.logoutUrl !== '/' && (
                <a href={revokeInfo.logoutUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-info-400
                    underline underline-offset-2 break-all hover:text-info-300">
                  <IconExternal className="w-3 h-3 shrink-0" />
                  {revokeInfo.logoutUrl}
                </a>
              )}
            </div>
            <button onClick={() => setRevokeInfo(null)}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg
                bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10
                transition-all duration-150">
              <IconX className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-16">
            <div className="w-7 h-7 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 text-white/30 font-body text-sm">
            No sessions found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>IP / MAC</th>
                  <th>Campaign</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const isActive = !!s.access_granted &&
                    !!s.expires_at &&
                    new Date(s.expires_at) > new Date();
                  return (
                    <tr key={s.id}>
                      {/* IP + MAC + dst */}
                      <td>
                        <code className="text-xs font-mono text-info-400">{s.ip_address}</code>
                        {s.mac_address && (
                          <div>
                            <code className="text-[10px] font-mono text-white/25">{s.mac_address}</code>
                          </div>
                        )}
                        {s.dst_url && (
                          <div className="text-[9px] text-white/15 font-mono truncate max-w-[120px]"
                            title={s.dst_url}>
                            ↗ {s.dst_url}
                          </div>
                        )}
                      </td>

                      {/* Campaign */}
                      <td className="text-white/50 text-xs">{s.campaign_name ?? '—'}</td>

                      {/* Progress badges */}
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <ProgressBadge ok={!!s.video_watched} label="Video" />
                          <ProgressBadge ok={!!s.survey_done}   label="Survey" />
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        {isActive ? (
                          <span className="badge-on">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
                            Online
                          </span>
                        ) : s.access_granted ? (
                          <span className="badge-off">Expired</span>
                        ) : (
                          <span className="badge-off">Pending</span>
                        )}
                      </td>

                      {/* Expires */}
                      <td className="text-xs text-white/30">
                        {s.expires_at ? new Date(s.expires_at).toLocaleString() : '—'}
                      </td>

                      {/* Created */}
                      <td className="text-xs text-white/30">
                        {new Date(s.created_at).toLocaleString()}
                      </td>

                      {/* Revoke action */}
                      <td>
                        {isActive && (
                          <button onClick={() => revoke(s.id)}
                            disabled={revoking === s.id}
                            className="btn btn-sm btn-danger flex items-center gap-1.5">
                            {revoking === s.id
                              ? <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                              : <IconTrash className="w-3.5 h-3.5" />
                            }
                            {revoking === s.id ? '…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Analytics page ─────────────────────────────────────────────────────────
export function Analytics() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected,  setSelected]  = useState('');
  const [data,      setData]      = useState<Record<string, {
    question: string; answers: Record<string, number>;
  }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.campaigns().then(c => {
      setCampaigns(c);
      const active = c.find(x => x.active === 1);
      if (active) setSelected(active.id);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    api.surveyResults(selected)
      .then(r => r.aggregates)
      .then(setData)
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-display font-extrabold text-2xl text-white mb-0.5">Analytics</h2>
          <p className="text-sm text-white/35 font-body">Survey response aggregates by campaign</p>
        </div>
        <select className="select w-48 text-sm py-2"
          value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center p-16">
          <div className="w-7 h-7 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
        </div>
      ) : Object.keys(data).length === 0 ? (
        <div className="panel p-16 text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-white/10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
          <p className="text-white/40 font-body text-sm">No survey responses yet</p>
          <p className="text-white/20 font-body text-xs mt-1">Responses will appear here once users complete the portal</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(data).map(([qId, { question, answers }]) => {
            const total  = Object.values(answers).reduce((a, b) => a + b, 0);
            const sorted = Object.entries(answers).sort((a, b) => b[1] - a[1]);
            return (
              <div key={qId} className="panel p-5">
                <p className="font-display font-semibold text-white text-sm leading-snug mb-1">
                  {question}
                </p>
                <p className="text-xs text-white/30 font-body mb-4">{total} responses</p>
                <div className="space-y-3">
                  {sorted.map(([answer, count]) => {
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={answer}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-white/65 font-body truncate mr-2">{answer}</span>
                          <span className="text-accent-400 font-display font-bold shrink-0">
                            {pct}%{' '}
                            <span className="text-white/25">({count})</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
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
  );
}
