// pm2 process config for the collaborative-editing (y-websocket) server.
//
// Usage:
//   export SESSION_SECRET="<same value as the Next.js app>"
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   # survive reboots
//
// SESSION_SECRET is intentionally NOT hard-coded here — export it in the shell
// (or your secrets manager) before `pm2 start` so it is inherited below.
module.exports = {
  apps: [
    {
      name: 'webmail-collab',
      script: 'scripts/collab-server.mjs',
      interpreter: 'node',
      instances: 1,            // y-websocket keeps room state in memory; do NOT cluster
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 50,
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        COLLAB_PORT: '1234',
        SESSION_SECRET: process.env.SESSION_SECRET,
      },
    },
  ],
};
