// src/pages/Sessions.tsx
import { useEffect, useState } from 'react';
import { api, Session, Campaign } from '../lib/api';

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
      font-display font-bold border
      ${ok
        ? 'bg-accent-500/10 text-accent-400 border-accent-500/25'
        : 'bg-white/5 text-white/25 border-white/10'}`}>
      {ok ? '✓' : '○'} {label}
    </span>
  );
}

export function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filter, setFilter]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

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
    if (!confirm('Revoke internet access for this session?')) return;
    setRevoking(id);
    try { await api.revokeSession(id); await load(); }
    finally { setRevoking(null); }
  };

  return (
    <div className="p-6">
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
          <button onClick={load} className="btn btn-surface btn-sm">⟳ Refresh</button>
        </div>
      </div>

      <div className="panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-16">
            <div className="w-7 h-7 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 text-white/30 font-body">No sessions found</div>
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
                  const isActive = !!s.access_granted && !!s.expires_at && new Date(s.expires_at) > new Date();
                  return (
                    <tr key={s.id}>
                      <td>
                        <code className="text-xs font-mono text-info-400">{s.ip_address}</code>
                        {s.mac_address && (
                          <div><code className="text-[10px] font-mono text-white/25">{s.mac_address}</code></div>
                        )}
                      </td>
                      <td className="text-white/50 text-xs">{s.campaign_name ?? '—'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Badge ok={s.video_watched} label="Video" />
                          <Badge ok={s.survey_done}   label="Survey" />
                        </div>
                      </td>
                      <td>
                        {isActive ? (
                          <span className="badge-on">🟢 Online</span>
                        ) : s.access_granted ? (
                          <span className="badge-off">Expired</span>
                        ) : (
                          <span className="badge-off">Pending</span>
                        )}
                      </td>
                      <td className="text-xs text-white/30">
                        {s.expires_at ? new Date(s.expires_at).toLocaleString() : '—'}
                      </td>
                      <td className="text-xs text-white/30">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                      <td>
                        {s.access_granted && new Date(s.expires_at ?? '') > new Date() && (
                          <button onClick={() => revoke(s.id)}
                            disabled={revoking === s.id}
                            className="btn btn-sm btn-danger">
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

// ── Analytics page ────────────────────────────────────────────────────────
export function Analytics() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected]   = useState('');
  const [data, setData]           = useState<Record<string, { question: string; answers: Record<string, number> }>>({});
  const [loading, setLoading]     = useState(false);

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
    api.surveyResults(selected).then(r => r.aggregates).then(setData).finally(() => setLoading(false));
  }, [selected]);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-display font-extrabold text-2xl text-white mb-0.5">Analytics</h2>
          <p className="text-sm text-white/35 font-body">Survey response aggregates by campaign</p>
        </div>
        <select className="select w-48 text-sm py-2" value={selected}
          onChange={e => setSelected(e.target.value)}>
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
          <div className="text-4xl mb-3">📊</div>
          <p className="text-white/40 font-body">No survey responses yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(data).map(([qId, { question, answers }]) => {
            const total = Object.values(answers).reduce((a, b) => a + b, 0);
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
                            {pct}% <span className="text-white/25">({count})</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/6 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400
                              transition-all duration-700"
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
