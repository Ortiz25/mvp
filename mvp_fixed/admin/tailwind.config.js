/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
      animation: {
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [],
};
