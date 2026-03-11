// ecosystem.config.cjs — PM2 process config
//
// setup.sh patches the cwd, DB_PATH, and MEDIA_DIR values at install time.
// ALL secrets (ADMIN_TOKEN) are loaded from backend/.env by dotenv.
// Do NOT put secrets in this file — it is committed to version control.
//
// Dev vs Live toggle:
//   MIKROTIK_MOCK=true   → dev/testing mode (no router needed)
//   MIKROTIK_MOCK=false  → live mode (MikroTik Hotspot must be configured)
//
// To switch modes on a running Pi:
//   1. Edit backend/.env   → MIKROTIK_MOCK=false
//   2. pm2 restart captive-api --update-env

module.exports = {
  apps: [{
    name:        'captive-api',
    script:      './backend/src/index.js',
    cwd:         '/home/admin/apps/mvp',          // patched by setup.sh
    instances:   1,
    exec_mode:   'fork',
    autorestart: true,
    watch:       false,
    max_memory_restart: '256M',

    env: {
      NODE_ENV:         'production',
      PORT:             3000,

      // ── Paths (patched by setup.sh at install time) ───────────────────
      DB_PATH:   '/home/admin/apps/mvp/data/captive.db',  // patched
      MEDIA_DIR: '/home/admin/apps/mvp/media',             // patched

      // ── CORS ─────────────────────────────────────────────────────────
      CORS_ORIGINS: 'http://captive.local,http://192.168.88.2',

      // ── After-grant fallback (if MikroTik provides no ?dst=) ─────────
      SUCCESS_REDIRECT: 'http://www.google.com',

      // ── MikroTik Hotspot ─────────────────────────────────────────────
      // Set MIKROTIK_MOCK=false in backend/.env when the router is ready.
      // These are overridden by backend/.env if that file is present.
      MIKROTIK_MOCK:    'true',   // ← change to 'false' for live mode
      MIKROTIK_HOST:    '192.168.88.1',
      MIKROTIK_HS_PORT: '80',

      // ── ADMIN_TOKEN is loaded from backend/.env — NOT set here ───────
      // Setting it here would override dotenv and cause 401 in the admin.
    },

    error_file:      '/home/admin/apps/mvp/logs/error.log',  // patched
    out_file:        '/home/admin/apps/mvp/logs/out.log',     // patched
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:      true,
  }],
};
