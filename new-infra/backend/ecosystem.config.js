// Reference PM2 configuration showing the EADDRINUSE fix.
// The Docker target does NOT use PM2; this file is provided only for
// comparison / temporary use during a non-Docker transition.

module.exports = {
  apps: [
    {
      name: 'triva-backend',
      script: 'dist/index.js',
      cwd: '/var/www/triva/backend',
      instances: 1,
      exec_mode: 'fork',        // <-- FIX: do not use cluster_mode with instances:1
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      // Do not duplicate application logs here; rely on stdout/stderr rotation.
      log_file: '/dev/null',
    },
  ],
};
