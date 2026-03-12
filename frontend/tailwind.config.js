/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        void:   '#040b14',
        night:  '#070f1c',
        dusk:   '#0b1524',
        slate:  '#101d2e',
        signal: '#00d2a0',
        aqua:   '#00b4ff',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
      },
      animation: {
        'fade-up':    'fadeUp 0.45s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in':    'fadeIn 0.35s ease both',
        'slide-up':   'slideUp 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'pop':        'pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
        'ping-slow':  'ping 2s cubic-bezier(0,0,0.2,1) infinite',
        'pulse-soft': 'pulse 2.5s ease-in-out infinite',
        'scan':       'scan 3s linear infinite',
      },
      keyframes: {
        fadeUp:  { '0%': { opacity:'0', transform:'translateY(14px)' }, '100%': { opacity:'1', transform:'translateY(0)' } },
        fadeIn:  { '0%': { opacity:'0' }, '100%': { opacity:'1' } },
        slideUp: { '0%': { opacity:'0', transform:'translateY(24px)' }, '100%': { opacity:'1', transform:'translateY(0)' } },
        pop:     { '0%': { opacity:'0', transform:'scale(0.85)' }, '100%': { opacity:'1', transform:'scale(1)' } },
        scan:    { '0%': { transform:'translateY(-100%)' }, '100%': { transform:'translateY(400%)' } },
      },
      boxShadow: {
        'card':   '0 2px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
        'lifted': '0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
        'signal': '0 6px 24px rgba(0,210,160,0.25)',
        'aqua':   '0 6px 24px rgba(0,180,255,0.25)',
      },
    },
  },
  plugins: [],
};
