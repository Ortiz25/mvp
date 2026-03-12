import { ReactNode, useState } from 'react';

// ── SVG icon set ───────────────────────────────────────────────────────────
type IP = { className?: string };
const IconGrid      = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
const IconMegaphone = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>;
const IconUsers     = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconBarChart  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>;
const IconShield    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconChevronL  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"/></svg>;
const IconChevronR  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,18 15,12 9,6"/></svg>;
const IconLogOut    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
const IconWifi      = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none"/></svg>;

// ── Nav config ─────────────────────────────────────────────────────────────
const NAV = [
  { id: 'overview',  Icon: IconGrid,      label: 'Overview'  },
  { id: 'campaigns', Icon: IconMegaphone, label: 'Campaigns' },
  { id: 'sessions',  Icon: IconUsers,     label: 'Sessions'  },
  { id: 'analytics', Icon: IconBarChart,  label: 'Analytics' },
];

interface Props {
  tab: string;
  onTab: (t: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export function AdminShell({ tab, onTab, onLogout, children }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`${open ? 'w-56' : 'w-16'} shrink-0 transition-all duration-300
        bg-surface-900 border-r border-white/[0.05] flex flex-col`}>

        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/[0.05]
          ${open ? '' : 'justify-center'}`}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-500 to-cyan-500
            flex items-center justify-center shrink-0
            shadow-[0_4px_16px_rgba(16,185,129,0.3)]">
            <IconShield className="w-4 h-4 text-surface-950" />
          </div>
          {open && (
            <div className="min-w-0">
              <p className="font-display font-bold text-sm text-white leading-tight truncate">
                CityNet Admin
              </p>
              <p className="text-[9px] font-body text-white/25 uppercase tracking-wider">
                Dashboard
              </p>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ id, Icon, label }) => (
            <button key={id} onClick={() => onTab(id)}
              className={`nav-item w-full text-left
                ${tab === id ? 'nav-item-active' : ''}
                ${!open ? 'justify-center px-2' : ''}`}>
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {open && <span>{label}</span>}
            </button>
          ))}
        </nav>

        {/* Bottom controls */}
        <div className="p-2 border-t border-white/[0.05] space-y-0.5">
          <button onClick={() => setOpen(s => !s)}
            className={`nav-item w-full text-left ${!open ? 'justify-center px-2' : ''}`}>
            {open
              ? <><IconChevronL className="w-[18px] h-[18px] shrink-0" /><span>Collapse</span></>
              : <IconChevronR className="w-[18px] h-[18px]" />
            }
          </button>
          <button onClick={onLogout}
            className={`nav-item w-full text-left text-danger-400 hover:text-danger-300
              ${!open ? 'justify-center px-2' : ''}`}>
            <IconLogOut className="w-[18px] h-[18px] shrink-0" />
            {open && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-surface-950/80 backdrop-blur-xl
          border-b border-white/[0.05] px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Current tab icon */}
            {(() => { const n = NAV.find(n => n.id === tab); return n ? <n.Icon className="w-4 h-4 text-white/40" /> : null; })()}
            <h1 className="font-display font-bold text-white capitalize">
              {NAV.find(n => n.id === tab)?.label ?? tab}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-accent-500/10 border border-accent-500/20
              rounded-full px-3 py-1">
              <IconWifi className="w-3.5 h-3.5 text-accent-400" />
              <span className="text-[10px] font-display font-bold text-accent-400 uppercase tracking-wider">
                Hotspot Mode
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
            </div>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
