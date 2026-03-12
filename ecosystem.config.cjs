// ecosystem.config.cjs — PM2 process config (RADIUS edition)
// setup.sh patches cwd, DB_PATH, MEDIA_DIR at install time.

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

      // Paths (patched by setup.sh at install time)
      DB_PATH:   '/home/admin/apps/mvp/data/captive.db',
      MEDIA_DIR: '/home/admin/apps/mvp/media',

      // CORS
      CORS_ORIGINS: 'http://captive.local,http://192.168.88.2',

      // MikroTik LAN IP (no API credentials needed with RADIUS)
      MIKROTIK_HOST: '192.168.88.1',

      // RADIUS DB — ADMIN_TOKEN and RADIUS_DB_PASS loaded from backend/.env
    },

    error_file:      '/home/admin/apps/mvp/logs/error.log',   // patched
    out_file:        '/home/admin/apps/mvp/logs/out.log',      // patched
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:      true,
  }],
};
