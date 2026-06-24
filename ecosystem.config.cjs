// pm2 process config — ONE process runs everything.
//
// The collab (y-websocket) server is started as a child process by the Next.js
// app via src/instrumentation.ts, so there is no separate pm2 entry for it.
//
// Usage (values come from ./.env, no manual env needed):
//   cd ~/shared-webmail-app
//   npm run build                 # produces .next/standalone + copies assets
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup       # survive reboots
//
// node_args loads ./.env at startup (Node >=20.12 --env-file-if-exists) so the
// app — and the collab child it spawns — get DATABASE_URL / SESSION_SECRET etc.
module.exports = {
  apps: [
    {
      name: 'shared-webmail-app',
      script: '.next/standalone/server.js',
      interpreter: 'node',
      node_args: '--env-file-if-exists=.env',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
      },
    },
  ],
};
