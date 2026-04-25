/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'sans-serif'],
        body:    ['"DM Sans"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        surface: {
          950: '#020609',
          900: '#050a0f',
          800: '#080f18',
          700: '#0d1825',
          600: '#122030',
          500: '#192c42',
        },
        accent: {
          50:  '#ecfdf5',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
        danger:  { 400: '#f87171', 500: '#ef4444' },
        warning: { 400: '#fbbf24', 500: '#f59e0b' },
        info:    { 400: '#60a5fa', 500: '#3b82f6' },
      },
      backgroundColor: {
        theme: {
          app:     'var(--bg-app)',
          sidebar: 'var(--bg-sidebar)',
          panel:   'var(--bg-panel)',
          input:   'var(--bg-input)',
        },
      },
      textColor: {
        theme: {
          primary:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted:     'var(--text-muted)',
          faint:     'var(--text-faint)',
        },
      },
      borderColor: {
        theme: {
          panel:  'var(--border-panel)',
          input:  'var(--border-input)',
          subtle: 'var(--border-subtle)',
        },
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [],
};
