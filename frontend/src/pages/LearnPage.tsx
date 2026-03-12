// src/pages/LearnPage.tsx
import { useNavigate } from 'react-router-dom';

const resources = [
  {
    name: 'Kolibri', tagline: 'Offline Education Platform', emoji: '📚',
    desc: 'Khan Academy content, literacy, numeracy, vocational skills — all offline.',
    url: 'http://kolibri.local:8080', badge: 'Offline · Free',
    color: 'border-purple-500/20 bg-purple-500/5',
    accent: 'text-purple-400',
    topics: ['Maths','Reading','Science','Skills'],
  },
  {
    name: 'Kiwix (Wikipedia)', tagline: 'Encyclopedia Offline', emoji: '🌍',
    desc: 'Millions of Wikipedia articles and reference content without internet.',
    url: 'http://kiwix.local:8888', badge: 'Offline · Free',
    color: 'border-blue-500/20 bg-blue-500/5',
    accent: 'text-blue-400',
    topics: ['History','Science','Geography','Culture'],
  },
  {
    name: 'Community Board', tagline: 'Local Notices & News', emoji: '📌',
    desc: 'Stay updated with community announcements, events, and local services.',
    url: '#', badge: 'Local',
    color: 'border-orange-500/20 bg-orange-500/5',
    accent: 'text-orange-400',
    topics: ['Events','Jobs','Health','Services'],
  },
];

export function LearnPage() {
  const navigate = useNavigate();
  return (
    <div className="px-6 py-6">
      <button onClick={() => navigate(-1)} className="btn-ghost mb-5">← Back</button>

      <h2 className="font-display font-extrabold text-xl text-white tracking-tight mb-1">
        📖 Learn & Explore
      </h2>
      <p className="text-sm text-white/40 font-body mb-6 leading-relaxed">
        These resources are hosted locally — no internet required.
      </p>

      <div className="flex flex-col gap-3">
        {resources.map(({ name, tagline, emoji, desc, url, badge, color, accent, topics }) => (
          <div key={name} className={`border rounded-2xl p-4 ${color}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl border ${color} flex items-center
                  justify-center text-2xl`}>
                  {emoji}
                </div>
                <div>
                  <p className="font-display font-bold text-sm text-white">{name}</p>
                  <p className={`text-xs font-semibold ${accent}`}>{tagline}</p>
                </div>
              </div>
              <span className={`text-[10px] font-bold border rounded-md px-2 py-0.5 ${accent}
                border-current/30 bg-current/10 whitespace-nowrap`}>
                {badge}
              </span>
            </div>
            <p className="text-xs text-white/50 font-body leading-relaxed mb-3">{desc}</p>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {topics.map(t => (
                <span key={t} className="text-[10px] bg-white/5 text-white/40 rounded-full px-2.5 py-0.5 font-body">
                  {t}
                </span>
              ))}
            </div>
            <a href={url}
              className={`inline-flex items-center gap-1 text-xs font-display font-bold
                no-underline border-b border-current/30 pb-0.5 ${accent}`}>
              Open {name} →
            </a>
          </div>
        ))}
      </div>

      <div className="mt-4 px-4 py-3 rounded-xl bg-brand-500/6 border border-brand-500/15
        text-xs text-white/40 font-body leading-relaxed">
        💡 <strong className="text-white/60">Tip:</strong> Kolibri and Kiwix work even without
        internet — they're served directly from the Pi.
      </div>
    </div>
  );
}

// Shared loading state (used across pages)
export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent
        animate-spin" />
      <p className="text-sm text-white/30 font-body">Loading…</p>
    </div>
  );
}
