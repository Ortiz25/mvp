// src/pages/Overview.tsx
import { useEffect, useState } from 'react';
import { api, Stats, Campaign } from '../lib/api';

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${color}`}>{value}</p>
      {sub && <p className="text-xs text-white/25 font-body mt-1">{sub}</p>}
    </div>
  );
}

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.stats(), api.campaigns()])
      .then(([s, c]) => { setStats(s); setCampaigns(c); })
      .finally(() => setLoading(false));
  }, []);

  const active = campaigns.find(c => c.active === 1);
  const convRate = stats && stats.total > 0
    ? Math.round((stats.completed / stats.total) * 100) : 0;

  if (loading) return <Spinner />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="font-display font-extrabold text-2xl text-white mb-0.5">Overview</h2>
        <p className="text-sm text-white/35 font-body">Real-time captive portal metrics</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sessions"    value={stats?.total ?? 0}     color="text-white"         sub="all time" />
        <StatCard label="Active Now"         value={stats?.active ?? 0}    color="text-accent-400"    sub="with internet" />
        <StatCard label="Completed Portal"   value={stats?.completed ?? 0} color="text-info-400"      sub="video + survey" />
        <StatCard label="Today"              value={stats?.today ?? 0}     color="text-warning-400"   sub="new sessions" />
      </div>

      {/* Conversion + active campaign row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversion rate */}
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-display font-bold text-white">Conversion Rate</p>
              <p className="text-xs text-white/35 font-body mt-0.5">Visitors who complete the portal flow</p>
            </div>
            <span className="font-display font-black text-4xl text-gradient-accent">{convRate}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400
                transition-all duration-1000 ease-out"
              style={{ width: `${convRate}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-white/25 font-body">
            <span>{stats?.completed} completed</span>
            <span>{stats?.total} total</span>
          </div>
        </div>

        {/* Active campaign */}
        <div className="panel p-5">
          <p className="text-xs font-display font-bold uppercase tracking-wider text-white/35 mb-3">
            Active Campaign
          </p>
          {active ? (
            <div>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-display font-bold text-white text-lg leading-tight">
                  {active.name}
                </h3>
                <span className="badge-on ml-2 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
                  Live
                </span>
              </div>
              {active.description && (
                <p className="text-sm text-white/40 font-body mb-3 leading-relaxed">
                  {active.description}
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Sessions', val: active.total_sessions },
                  { label: 'Granted',  val: active.granted_sessions },
                  { label: 'Duration', val: `${active.session_hours}h` },
                ].map(({ label, val }) => (
                  <div key={label} className="text-center p-2.5 rounded-xl bg-white/5">
                    <p className="font-display font-bold text-lg text-white">{val}</p>
                    <p className="text-[10px] text-white/30 font-body">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-4xl mb-2">📭</p>
              <p className="text-sm text-white/35 font-body">No active campaign</p>
              <p className="text-xs text-white/20 font-body mt-1">Go to Campaigns to activate one</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent campaigns */}
      {campaigns.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="panel-header">
            <p className="font-display font-bold text-white">All Campaigns</p>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Sessions</th>
                <th>Granted</th>
                <th>Duration</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id}>
                  <td className="font-display font-semibold text-white/85">{c.name}</td>
                  <td><StatusBadge active={c.active} /></td>
                  <td>{c.total_sessions}</td>
                  <td>{c.granted_sessions}</td>
                  <td>{c.session_hours}h</td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ active }: { active: number }) {
  return active === 1
    ? <span className="badge-on">Active</span>
    : <span className="badge-off">Inactive</span>;
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="w-8 h-8 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
    </div>
  );
}
