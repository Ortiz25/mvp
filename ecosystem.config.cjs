// ecosystem.config.cjs — PM2 process config (Pi-as-router edition)

module.exports = {
  apps: [{
    name:        'captive-api',
    script:      './backend/src/index.js',
    cwd:         '/home/admin/apps/captive-portal',   // patched by setup.sh
    instances:   1,
    exec_mode:   'fork',
    autorestart: true,
    watch:       false,
    max_memory_restart: '256M',

    env: {
      NODE_ENV:  'production',
      PORT:      3000,

      // Paths (patched by setup.sh at install time)
      DB_PATH:   '/home/admin/apps/captive-portal/data/captive.db',
      MEDIA_DIR: '/home/admin/apps/captive-portal/media',

      // CORS — Pi LAN IP
      CORS_ORIGINS: 'http://captive.local,http://192.168.100.1',

      // LAN interface — used for iptables MAC rules
      LAN_IFACE: 'eth1',

      // RADIUS_DB_PASS and ADMIN_TOKEN loaded from backend/.env
    },

    error_file:      '/home/admin/apps/captive-portal/logs/error.log',
    out_file:        '/home/admin/apps/captive-portal/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:      true,
  }],
};
