import { useTheme } from '../context/ThemeContext';

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={[
        'relative flex items-center shrink-0 cursor-pointer',
        'w-[52px] h-7 rounded-full border transition-all duration-300 ease-in-out',
        isDark
          ? 'bg-surface-700 border-white/10'
          : 'bg-accent-500/15 border-accent-500/30',
      ].join(' ')}
    >
      {/* Track icons */}
      <span className="absolute left-1.5 text-[10px] select-none pointer-events-none transition-opacity duration-200"
        style={{ opacity: isDark ? 0.25 : 0 }}>
        🌙
      </span>
      <span className="absolute right-1.5 text-[10px] select-none pointer-events-none transition-opacity duration-200"
        style={{ opacity: isDark ? 0 : 0.8 }}>
        ☀️
      </span>

      {/* Thumb */}
      <span className={[
        'absolute top-0.5 w-6 h-6 rounded-full shadow-md flex items-center justify-center',
        'transition-all duration-300 ease-in-out text-[11px]',
        isDark
          ? 'left-0.5 bg-surface-500 shadow-black/40'
          : 'left-[calc(100%-26px)] bg-white shadow-black/15',
      ].join(' ')}>
        {isDark ? '🌙' : '☀️'}
      </span>
    </button>
  );
}
