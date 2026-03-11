// src/components/layout/AdminShell.tsx
import { ReactNode, useState } from 'react';

interface Props {
  tab: string;
  onTab: (t: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

const NAV = [
  { id: 'overview',   icon: '📊', label: 'Overview' },
  { id: 'campaigns',  icon: '📣', label: 'Campaigns' },
  { id: 'sessions',   icon: '👥', label: 'Sessions' },
  { id: 'analytics',  icon: '📈', label: 'Analytics' },
];

export function AdminShell({ tab, onTab, onLogout, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-16'} shrink-0 transition-all duration-300
        bg-surface-900 border-r border-white/[0.05] flex flex-col`}>
        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/[0.05]
          ${sidebarOpen ? '' : 'justify-center'}`}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-500 to-cyan-500
            flex items-center justify-center text-sm shrink-0">
            🛡️
          </div>
          {sidebarOpen && (
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

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ id, icon, label }) => (
            <button key={id} onClick={() => onTab(id)}
              className={`nav-item w-full text-left
                ${tab === id ? 'nav-item-active' : ''}
                ${!sidebarOpen ? 'justify-center px-2' : ''}`}>
              <span className="text-base shrink-0">{icon}</span>
              {sidebarOpen && <span>{label}</span>}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-2 border-t border-white/[0.05] space-y-0.5">
          <button
            onClick={() => setSidebarOpen(s => !s)}
            className={`nav-item w-full text-left ${!sidebarOpen ? 'justify-center px-2' : ''}`}>
            <span className="text-base shrink-0">{sidebarOpen ? '◀' : '▶'}</span>
            {sidebarOpen && <span>Collapse</span>}
          </button>
          <button
            onClick={onLogout}
            className={`nav-item w-full text-left text-danger-400 hover:text-danger-300
              ${!sidebarOpen ? 'justify-center px-2' : ''}`}>
            <span className="text-base shrink-0">⏻</span>
            {sidebarOpen && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-surface-950/80 backdrop-blur-xl
          border-b border-white/[0.05] px-6 py-3
          flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-display font-bold text-white capitalize">
              {NAV.find(n => n.id === tab)?.label ?? tab}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent-400 animate-pulse" />
              <span className="text-xs text-white/35 font-body">Live</span>
            </div>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
