import { ReactNode, useState, useEffect, useRef } from 'react';
import { ThemeToggle } from '../ThemeToggle';
import { useTheme } from '../../context/ThemeContext';

// ── SVG icon set ───────────────────────────────────────────────────────────
type IP = { className?: string };
const IconGrid      = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
const IconMegaphone = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>;
const IconUsers     = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconBarChart  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>;
const IconShield    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconLogOut    = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
const IconWifi      = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none"/></svg>;
const IconChevronL  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"/></svg>;
const IconChevronR  = ({ className = 'w-5 h-5' }: IP) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,18 15,12 9,6"/></svg>;

const IconMenu = ({ open, className = 'w-5 h-5' }: IP & { open?: boolean }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {open
      ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
      : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
    }
  </svg>
);

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
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const { isDark } = useTheme();
  const _sidebarRef = useRef<HTMLElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Lock body scroll when mobile sidebar open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleTabChange = (id: string) => {
    onTab(id);
    setMobileOpen(false);
  };

  const currentNav = NAV.find(n => n.id === tab);
  const sidebarCollapsed = !desktopOpen;

  return (
    <div className="min-h-screen flex bg-surface-950">

      {/* Mobile overlay */}
      <div
        className={[
          'fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden',
          'transition-opacity duration-300',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        ref={_sidebarRef}
        className={[
          'fixed inset-y-0 left-0 z-40 flex flex-col shrink-0',
          isDark ? 'bg-surface-900 border-white/[0.05]' : 'bg-white border-black/[0.07]',
          'border-r transition-all duration-300 ease-in-out',
          // Mobile: slide from left
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: always visible, width changes
          'lg:relative lg:translate-x-0',
          sidebarCollapsed ? 'lg:w-[68px]' : 'lg:w-60',
          // Mobile fixed width
          'w-60',
        ].join(' ')}
      >
        {/* Logo row */}
        <div className={[
          'flex items-center gap-3 px-4 py-5 shrink-0',
          isDark ? 'border-b border-white/[0.05]' : 'border-b border-black/[0.06]',
          sidebarCollapsed ? 'lg:justify-center lg:px-2' : '',
        ].join(' ')}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-500 to-cyan-500
            flex items-center justify-center shrink-0 shadow-[0_4px_16px_rgba(16,185,129,0.3)]">
            <IconShield className="w-4 h-4 text-theme-primary" />
          </div>
          <div className={['min-w-0 overflow-hidden', sidebarCollapsed ? 'lg:hidden' : ''].join(' ')}>
            <p className="font-display font-bold text-sm leading-tight truncate" style={{ color: 'var(--text-primary)' }}>CityNet Admin</p>
            <p className="text-[9px] font-body uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Dashboard</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ id, Icon, label }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              title={sidebarCollapsed ? label : undefined}
              className={[
                'nav-item w-full text-left group relative',
                tab === id ? 'nav-item-active' : '',
                sidebarCollapsed ? 'lg:justify-center lg:px-2' : '',
              ].join(' ')}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{label}</span>
              {/* Collapsed tooltip */}
              {sidebarCollapsed && (
                <span className={[
                  'hidden lg:block absolute left-full ml-3 px-2.5 py-1.5 rounded-lg',
                  'text-xs font-display font-semibold whitespace-nowrap z-50 shadow-xl',
                  'opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150',
                  isDark
                    ? 'bg-surface-700 border border-white/10 text-theme-primary'
                    : 'bg-white border border-black/10 text-gray-800 shadow-lg',
                ].join(' ')}>
                  {label}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className={['p-2 space-y-0.5 shrink-0', isDark ? 'border-t border-white/[0.05]' : 'border-t border-black/[0.06]'].join(' ')}>
          {/* Desktop-only collapse toggle */}
          <button
            onClick={() => setDesktopOpen(s => !s)}
            className={[
              'nav-item w-full text-left hidden lg:flex',
              sidebarCollapsed ? 'justify-center px-2' : '',
            ].join(' ')}
          >
            {desktopOpen
              ? <><IconChevronL className="w-[18px] h-[18px] shrink-0" /><span>Collapse</span></>
              : <IconChevronR className="w-[18px] h-[18px]" />
            }
          </button>
          <button
            onClick={onLogout}
            className={[
              'nav-item w-full text-left text-danger-400 hover:text-danger-300',
              sidebarCollapsed ? 'lg:justify-center lg:px-2' : '',
            ].join(' ')}
          >
            <IconLogOut className="w-[18px] h-[18px] shrink-0" />
            <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className={[
          'sticky top-0 z-20 backdrop-blur-xl px-4 md:px-6 py-3',
          'flex items-center justify-between gap-3 shrink-0',
          isDark
            ? 'bg-surface-950/80 border-b border-white/[0.05]'
            : 'bg-white/80 border-b border-black/[0.06]',
        ].join(' ')}>

          <div className="flex items-center gap-3 min-w-0">
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setMobileOpen(s => !s)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              className={[
                'lg:hidden flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-150 shrink-0',
                isDark
                  ? 'bg-white/[0.05] border border-white/[0.08] text-theme-faint hover:text-theme-primary hover:bg-white/10'
                  : 'bg-black/[0.04] border border-black/[0.08] text-theme-muted hover:text-theme-primary hover:bg-black/[0.07]',
              ].join(' ')}
            >
              <IconMenu open={mobileOpen} className="w-[18px] h-[18px]" />
            </button>

            {/* Page title */}
            <div className="flex items-center gap-2 min-w-0">
              {currentNav && (
                <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                  <currentNav.Icon className="w-4 h-4" />
                </span>
              )}
              <h1 className="font-display font-bold text-sm md:text-base leading-none truncate"
                style={{ color: 'var(--text-primary)' }}>
                {currentNav?.label ?? tab}
              </h1>
            </div>
          </div>

          {/* Right side: status pill + theme toggle */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Hotspot status */}
            <div className="flex items-center gap-1.5 bg-accent-500/10 border border-accent-500/20
              rounded-full px-2.5 py-1.5 md:px-3">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
              <IconWifi className="w-3 h-3 text-accent-400" />
              <span className="hidden sm:inline text-[10px] font-display font-bold text-accent-400 uppercase tracking-wider">
                Hotspot
              </span>
            </div>

            {/* Theme toggle */}
            <ThemeToggle />
          </div>
        </header>

        {/* Page content — scrollable */}
        <main className="flex-1 overflow-auto" style={{ background: 'var(--bg-app)' }}>
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className={[
          'lg:hidden sticky bottom-0 z-20 shrink-0 backdrop-blur-xl',
          'flex items-stretch justify-around',
          isDark
            ? 'bg-surface-900/95 border-t border-white/[0.05]'
            : 'bg-white/95 border-t border-black/[0.06]',
        ].join(' ')}>
          {NAV.map(({ id, Icon, label }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={[
                'flex flex-col items-center justify-center gap-1 flex-1 py-2.5 px-1',
                'transition-colors duration-150 relative',
                tab === id ? 'text-accent-400' : 'text-theme-faint',
              ].join(' ')}
            >
              {tab === id && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5
                  bg-accent-400 rounded-full" />
              )}
              <Icon className={['w-[18px] h-[18px] transition-transform duration-150',
                tab === id ? 'scale-110' : ''].join(' ')} />
              <span className={[
                'text-[9px] font-display font-bold uppercase tracking-wider',
                tab === id ? 'text-accent-400' : 'text-theme-faint',
              ].join(' ')}>
                {label}
              </span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
