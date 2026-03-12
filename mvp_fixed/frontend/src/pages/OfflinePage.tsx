import { useState } from 'react';
import {
  IconBook, IconGlobe, IconMapPin, IconHeartbeat, IconUsers,
  IconSignal, IconExternalLink, IconArrow, IconZap, IconStar
} from '../components/layout/Shell';

// ── App definitions ────────────────────────────────────────────────────────
type AppCategory = 'all' | 'education' | 'info' | 'community' | 'health';

interface App {
  id: string;
  name: string;
  tagline: string;
  desc: string;
  url: string;
  Icon: React.FC<{ className?: string }>;
  category: AppCategory;
  accent: string;       // Tailwind color class prefix
  available: boolean;   // false = coming soon
  featured?: boolean;
}

const APPS: App[] = [
  {
    id: 'kolibri',
    name: 'Kolibri',
    tagline: 'Learn anything, offline',
    desc: 'Khan Academy, CK-12, and thousands of courses — all without internet.',
    url: 'http://kolibri.local',
    Icon: IconBook,
    category: 'education',
    accent: 'violet',
    available: true,
    featured: true,
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    tagline: 'The world\'s encyclopedia',
    desc: 'Full offline Wikipedia via Kiwix. Browse millions of articles.',
    url: 'http://kiwix.local',
    Icon: IconGlobe,
    category: 'info',
    accent: 'sky',
    available: true,
    featured: true,
  },
  {
    id: 'community',
    name: 'Community Board',
    tagline: 'Local notices & events',
    desc: 'Announcements, job postings, and community updates for your area.',
    url: '#',
    Icon: IconMapPin,
    category: 'community',
    accent: 'amber',
    available: false,
  },
  {
    id: 'health',
    name: 'Health Info',
    tagline: 'Local health resources',
    desc: 'Clinic hours, health guides, and emergency contacts for your community.',
    url: '#',
    Icon: IconHeartbeat,
    category: 'health',
    accent: 'rose',
    available: false,
  },
  {
    id: 'jobs',
    name: 'Job Board',
    tagline: 'Opportunities near you',
    desc: 'Local job listings, CV tips, and skills workshops.',
    url: '#',
    Icon: IconUsers,
    category: 'community',
    accent: 'signal',
    available: false,
  },
  {
    id: 'network',
    name: 'Network Status',
    tagline: 'Live signal info',
    desc: 'Check your connection quality, active sessions, and usage.',
    url: '#',
    Icon: IconSignal,
    category: 'info',
    accent: 'aqua',
    available: false,
  },
];

const ACCENT: Record<string, { tile: string; icon: string; badge: string }> = {
  violet: { tile: 'border-violet-500/25 bg-violet-500/[0.06] hover:bg-violet-500/[0.10]', icon: 'bg-violet-500/15 text-violet-300', badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  sky:    { tile: 'border-sky-500/25 bg-sky-500/[0.06] hover:bg-sky-500/[0.10]',         icon: 'bg-sky-500/15 text-sky-300',     badge: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  amber:  { tile: 'border-amber-500/25 bg-amber-500/[0.06] hover:bg-amber-500/[0.08]',   icon: 'bg-amber-500/15 text-amber-300', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  rose:   { tile: 'border-rose-500/25 bg-rose-500/[0.06] hover:bg-rose-500/[0.08]',     icon: 'bg-rose-500/15 text-rose-300',   badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  signal: { tile: 'border-signal/25 bg-signal/[0.06] hover:bg-signal/[0.10]',           icon: 'bg-signal/15 text-signal',       badge: 'bg-signal/10 text-signal border-signal/20' },
  aqua:   { tile: 'border-aqua/25 bg-aqua/[0.06] hover:bg-aqua/[0.10]',                 icon: 'bg-aqua/15 text-aqua',           badge: 'bg-aqua/10 text-aqua border-aqua/20' },
};

const CATEGORIES: { id: AppCategory; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'education', label: 'Education' },
  { id: 'info',      label: 'Info' },
  { id: 'community', label: 'Community' },
  { id: 'health',    label: 'Health' },
];

// ── Components ─────────────────────────────────────────────────────────────

function FeaturedCard({ app }: { app: App }) {
  const a = ACCENT[app.accent];
  return (
    <a href={app.available ? app.url : undefined}
      className={`app-tile border ${a.tile} transition-all duration-200
        ${app.available ? 'cursor-pointer' : 'cursor-default opacity-70'}
        animate-fade-up`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.icon}`}>
          <app.Icon className="w-5 h-5" />
        </div>
        <div className="flex gap-1.5 ml-auto flex-wrap justify-end">
          {app.featured && (
            <span className={`chip border text-[9px] ${a.badge}`}>
              <IconStar className="w-2.5 h-2.5" /> Featured
            </span>
          )}
          {!app.available && (
            <span className="chip chip-muted text-[9px]">Soon</span>
          )}
          {app.available && (
            <span className="chip chip-live text-[9px]">Available</span>
          )}
        </div>
      </div>

      <div>
        <h3 className="font-display font-bold text-white text-[15px] leading-tight mb-0.5">
          {app.name}
        </h3>
        <p className="text-[10px] font-body text-white/40 leading-relaxed">{app.desc}</p>
      </div>

      {app.available && (
        <div className="flex items-center gap-1.5 mt-auto pt-1">
          <span className="text-[11px] font-display font-bold text-white/50">Open</span>
          <IconArrow className="w-3.5 h-3.5 text-white/30" />
        </div>
      )}
    </a>
  );
}

function AppRow({ app, delay = 0 }: { app: App; delay?: number }) {
  const a = ACCENT[app.accent];
  return (
    <a href={app.available ? app.url : undefined}
      className={`flex items-center gap-3 p-3.5 rounded-xl border
        transition-all duration-200 no-underline
        ${a.tile}
        ${app.available ? 'cursor-pointer group' : 'cursor-default opacity-60'}
        animate-fade-up`}
      style={{ animationDelay: `${delay}ms` }}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${a.icon}`}>
        <app.Icon className="w-4.5 h-4.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-display font-bold text-white text-[13px] leading-tight">{app.name}</p>
          {!app.available && <span className="chip chip-muted text-[8px] py-0.5">Coming soon</span>}
        </div>
        <p className="text-[11px] text-white/35 font-body leading-tight truncate">{app.tagline}</p>
      </div>
      {app.available && (
        <IconExternalLink className="w-4 h-4 text-white/20 shrink-0 group-hover:text-white/50 transition-colors" />
      )}
    </a>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function OfflinePage() {
  const [category, setCategory] = useState<AppCategory>('all');

  const featured  = APPS.filter(a => a.featured);
  const rest      = APPS.filter(a => !a.featured && (category === 'all' || a.category === category));
  const available = APPS.filter(a => a.available).length;

  return (
    <div className="px-4 py-5 overflow-y-auto max-h-[calc(100vh-260px)]">

      {/* Header */}
      <div className="mb-4 animate-fade-up">
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-aqua/60 mb-1">
              Offline Apps
            </p>
            <h2 className="font-display font-extrabold text-[20px] text-white leading-tight tracking-tight">
              Available on<br /><span className="bg-gradient-to-r from-aqua to-signal bg-clip-text text-transparent">This Network</span>
            </h2>
          </div>
          <div className="chip chip-info mt-1.5 shrink-0">
            <IconZap className="w-3 h-3" />
            {available} Live
          </div>
        </div>
        <p className="text-[11px] text-white/30 font-body mt-2 leading-relaxed">
          These apps work without internet — accessible to everyone on this Wi-Fi.
        </p>
      </div>

      {/* Featured apps grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-5 animate-fade-up anim-d1">
        {featured.map(app => <FeaturedCard key={app.id} app={app} />)}
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 -mx-1 px-1 animate-fade-up anim-d2">
        {CATEGORIES.map(c => (
          <button key={c.id} onClick={() => setCategory(c.id)}
            className={`shrink-0 text-[10px] font-display font-bold uppercase tracking-wider
              px-3 py-1.5 rounded-lg border transition-all duration-150
              ${category === c.id
                ? 'bg-signal/15 border-signal/30 text-signal'
                : 'bg-white/[0.03] border-white/[0.07] text-white/30 hover:text-white/60 hover:border-white/15'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* App list */}
      <div className="flex flex-col gap-2 animate-fade-up anim-d3">
        {rest.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-white/25 font-body">No apps in this category yet.</p>
          </div>
        ) : (
          rest.map((app, i) => <AppRow key={app.id} app={app} delay={i * 40} />)
        )}
      </div>

      {/* Coming soon note */}
      <div className="mt-5 px-4 py-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] animate-fade-up anim-d4">
        <p className="text-[10px] font-display font-bold text-white/30 uppercase tracking-wider mb-1">
          More coming soon
        </p>
        <p className="text-[11px] text-white/20 font-body leading-relaxed">
          New apps and services are added regularly. Check back after your next visit.
        </p>
      </div>
    </div>
  );
}
