import { useEffect, useState } from 'react';
import { api, Stats, Campaign } from '../lib/api';

// ── SVG icons ──────────────────────────────────────────────────────────────
type IP = { className?: string };
const IconUsers    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconZap      = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"/></svg>;
const IconCheck    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>;
const IconCalendar = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconWifi     = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none"/></svg>;
const IconRouter   = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6.01 18H6"/><path d="M10.01 18H10"/><path d="M15 10h5a2 2 0 0 1 2 2v2"/><path d="M4 10V6a2 2 0 0 1 2-2h8.5L19 6.5"/><path d="M4 10h16"/></svg>;
const IconPlay     = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/></svg>;
const IconInfo     = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, Icon, color }: {
  label: string; value: number | string; sub?: string;
  Icon: React.FC<{ className?: string }>; color: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-3">
        <p className="stat-label">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className={`stat-value ${color.replace(/bg-\S+/, '').replace(/\/\d+/, '').trim()}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-white/25 font-body mt-1">{sub}</p>}
    </div>
  );
}

export function Overview() {
  const [stats,     setStats]     = useState<Stats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([api.stats(), api.campaigns()])
      .then(([s, c]) => { setStats(s); setCampaigns(c); })
      .finally(() => setLoading(false));
  }, []);

  const active   = campaigns.filter(c => c.active === 1);
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
        <StatCard label="Total Sessions"  value={stats?.total ?? 0}     sub="all time"          Icon={IconUsers}    color="bg-white/[0.06] text-white" />
        <StatCard label="Active Now"       value={stats?.active ?? 0}    sub="with internet"     Icon={IconZap}      color="bg-accent-500/15 text-accent-400" />
        <StatCard label="Completed Portal" value={stats?.completed ?? 0} sub="video + survey"    Icon={IconCheck}    color="bg-info-500/15 text-info-400" />
        <StatCard label="Today"            value={stats?.today ?? 0}     sub="new sessions"      Icon={IconCalendar} color="bg-warning-500/15 text-warning-400" />
      </div>

      {/* Conversion + active campaign */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversion rate */}
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-display font-bold text-white">Conversion Rate</p>
              <p className="text-xs text-white/35 font-body mt-0.5">Visitors who complete the portal</p>
            </div>
            <span className="font-display font-black text-4xl text-gradient-accent">{convRate}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400
              transition-all duration-1000 ease-out" style={{ width: `${convRate}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-white/25 font-body">
            <span>{stats?.completed} completed</span>
            <span>{stats?.total} total</span>
          </div>
        </div>

        {/* Active campaigns */}
        <div className="panel p-5">
          <p className="text-xs font-display font-bold uppercase tracking-wider text-white/35 mb-3">
            Active Campaigns
          </p>
          {active.length > 0 ? (
            <div className="space-y-3">
              {active.slice(0, 2).map(c => (
                <div key={c.id} className="flex items-start justify-between">
                  <div className="min-w-0 flex-1 mr-3">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-display font-bold text-white text-[14px] leading-tight truncate">
                        {c.name}
                      </h3>
                      <span className="badge-on shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
                        Live
                      </span>
                    </div>
                    <div className="flex gap-3">
                      {[
                        { label: 'Sessions', val: c.total_sessions },
                        { label: 'Granted',  val: c.granted_sessions },
                        { label: 'Duration', val: `${c.session_hours}h` },
                      ].map(({ label, val }) => (
                        <div key={label} className="text-center px-2.5 py-1.5 rounded-lg bg-white/5">
                          <p className="font-display font-bold text-sm text-white">{val}</p>
                          <p className="text-[9px] text-white/30 font-body">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm text-white/35 font-body">No active campaigns</p>
              <p className="text-xs text-white/20 font-body mt-1">Go to Campaigns to activate one</p>
            </div>
          )}
        </div>
      </div>

      {/* Hotspot status */}
      <HotspotStatus activeCount={stats?.active ?? 0} />

      {/* Campaigns table */}
      {campaigns.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="panel-header">
            <p className="font-display font-bold text-white">All Campaigns</p>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>Sessions</th>
                <th>Granted</th><th>Duration</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id}>
                  <td className="font-display font-semibold text-white/85">{c.name}</td>
                  <td>{c.active === 1
                    ? <span className="badge-on">Active</span>
                    : <span className="badge-off">Inactive</span>}
                  </td>
                  <td>{c.total_sessions}</td>
                  <td>{c.granted_sessions}</td>
                  <td>{c.session_hours}h</td>
                  <td className="text-white/40">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Hotspot status widget ──────────────────────────────────────────────────
function HotspotStatus({ activeCount }: { activeCount: number }) {
  const [status, setStatus] = useState<{ ok: boolean; mode?: string; error?: string } | null>(null);

  useEffect(() => {
    api.mikrotik()
      .then(() => setStatus({ ok: true, mode: 'hotspot' }))
      .catch(() => setStatus({ ok: false, error: 'Unreachable' }));
  }, []);

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent-500/10 border border-accent-500/20
            flex items-center justify-center">
            <IconRouter className="w-5 h-5 text-accent-400" />
          </div>
          <div>
            <p className="font-display font-bold text-white">MikroTik Hotspot</p>
            <p className="text-xs text-white/35 font-body mt-0.5">
              Browser-redirect model — no API credentials required
            </p>
          </div>
        </div>
        <div className="shrink-0 mt-1">
          {status === null ? (
            <div className="w-5 h-5 rounded-full border-2 border-accent-500/30 border-t-accent-500 animate-spin" />
          ) : status.ok ? (
            <span className="badge-on">Reachable</span>
          ) : (
            <span className="badge-off">Unreachable</span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <p className="font-display font-bold text-2xl text-accent-400">{activeCount}</p>
          <p className="text-[10px] text-white/30 font-body mt-0.5">Active sessions</p>
        </div>
        <div className="text-center p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <IconWifi className="w-4 h-4 text-info-400" />
          </div>
          <p className="text-[10px] text-white/30 font-body">Native sessions</p>
          <p className="text-[9px] text-white/20 font-body">RouterOS managed</p>
        </div>
        <div className="text-center p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <IconPlay className="w-4 h-4 text-accent-400" />
          </div>
          <p className="text-[10px] text-white/30 font-body">Survive reboots</p>
          <p className="text-[9px] text-white/20 font-body">No resync needed</p>
        </div>
      </div>

      {/* How it works */}
      <div className="flex items-start gap-2 bg-info-500/[0.05] border border-info-500/15 rounded-xl p-3">
        <IconInfo className="w-4 h-4 text-info-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-white/40 font-body leading-relaxed">
          Sessions are authenticated via browser redirect to the MikroTik Hotspot login URL.
          The router manages session state natively — no address-list, no API calls, no reboot issues.
        </p>
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="w-8 h-8 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
    </div>
  );
}
