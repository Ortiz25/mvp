// ecosystem.config.cjs — PM2 process config
module.exports = {
  apps: [{
    name:        'captive-api',
    script:      '/home/admin/apps/mvp/backend/src/index.js',   // entry point (not app.js)
    cwd:         '/home/admin/captive-portal',
    instances:   1,
    exec_mode:   'fork',
    autorestart: true,
    watch:       false,
    max_memory_restart: '256M',

    env: {
      NODE_ENV:          'production',
      PORT:              3000,

      // Database
      DB_PATH:           '/home/admin/captive-portal/data/captive.db',

      // Media / video uploads
      MEDIA_DIR:         '/home/admin/captive-portal/media',

      // Admin dashboard token — CHANGE THIS
      ADMIN_TOKEN:       'CHANGE_ME_ADMIN_TOKEN',

      // CORS — portal (port 80 via nginx) + admin (port 8090)
      CORS_ORIGINS:      'http://captive.local,http://192.168.88.2,http://192.168.88.2:8090',

      // MikroTik router
      MIKROTIK_MOCK:     'false',
      MIKROTIK_HOST:     '192.168.88.1',
      MIKROTIK_USER:     'captive-api',
      MIKROTIK_PASSWORD: 'm0t0m0t0',
      MIKROTIK_PORT:     8728,

      // Redirect after access granted
      SUCCESS_REDIRECT:  'http://www.google.com',
    },

    error_file:      '/home/admin/captive-portal/logs/error.log',
    out_file:        '/home/admin/captive-portal/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:      true,
  }],
};
