// Helpers of scripts/with-db.mjs (kept apart so they can be tested).

/** Where DATABASE_URL points, and whether that is this computer (the only case where a database is started for you). */
export function parseDbTarget(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
  const host = u.hostname;
  return {
    host,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    isLocal: ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host),
  };
}

/** The part of the command line after "--": what to run once the database is up. */
export function splitArgs(argv) {
  const i = argv.indexOf('--');
  const flags = i < 0 ? [] : argv.slice(0, i);
  const command = i < 0 ? argv : argv.slice(i + 1);
  return { migrate: flags.includes('--migrate'), command };
}

/** Environment for `docker compose -f docker-compose.dev.yml`: the database is made with the user / password / name of DATABASE_URL. */
export function composeEnv(target, base = process.env) {
  return {
    ...base,
    DEV_DB_PORT: String(target.port),
    DEV_DB_USER: target.user || 'webmail',
    DEV_DB_PASSWORD: target.password || 'webmail',
    DEV_DB_NAME: target.database,
  };
}
