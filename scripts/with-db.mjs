// Runs a command with the development database up, and stops the database again afterwards.
//
//   node scripts/with-db.mjs [--migrate] -- <command...>
//
// - DATABASE_URL (from .env) is read. If it does not point at this computer (localhost), or something already answers there
//   (a database you started yourself, or another terminal running this script), nothing is started and nothing is stopped.
// - Otherwise `docker compose -f docker-compose.dev.yml up -d --wait db` starts a PostgreSQL, and it is stopped when the command ends
//   (Ctrl+C included). The data stays in a docker volume for next time (`npm run db:reset` throws it away).
// - --migrate applies the pending migrations (prisma migrate deploy) first, so a new database is ready to use.
// - DEV_DB=off: do nothing of the above and just run the command.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeEnv, loopbackUrl, parseDbTarget, splitArgs } from './lib/dev-db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const COMPOSE = ['compose', '-f', 'docker-compose.dev.yml'];

const { migrate, command } = splitArgs(process.argv.slice(2));
if (command.length === 0) { console.error('使い方: node scripts/with-db.mjs [--migrate] -- <実行するコマンド>'); process.exit(2); }
try { process.loadEnvFile('.env'); } catch { /* no .env: the environment may already have DATABASE_URL */ }

const say = msg => console.log(`[db] ${msg}`);
const reachable = (host, port) => new Promise(resolve => {
  const s = net.connect({ host, port, timeout: 1500 });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('timeout', () => { s.destroy(); resolve(false); });
  s.once('error', () => resolve(false));
});
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...opts });

async function startDb() {
  if (process.env.DEV_DB === 'off') return null;
  const target = parseDbTarget(process.env.DATABASE_URL || '');
  if (!target) { say('DATABASE_URL が見つかりません（.env を確認してください）。データベースは起動しません'); return null; }
  if (!target.isLocal) { say(`接続先は ${target.host} です。自分のPCではないので、データベースは起動しません`); return null; }
  if (await reachable('127.0.0.1', target.port)) { say(`localhost:${target.port} は既に動いています。そのまま使います（終了しても止めません）`); return null; }

  const probe = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) {
    console.error(`
[db] localhost:${target.port} にデータベースがなく、Docker も使えませんでした。次のどちらかにしてください。
  - Docker を起動する（Docker Desktop など。入っていなければインストール）
  - 自分で PostgreSQL を起動し、.env の DATABASE_URL をそれに合わせる（その場合、DEV_DB=off を付けても構いません）`);
    process.exit(1);
  }
  say(`データベースを起動します（docker compose / localhost:${target.port}）…`);
  const up = run('docker', [...COMPOSE, 'up', '-d', '--wait', 'db'], { env: composeEnv(target) });
  if (up.status !== 0) { console.error(`[db] 起動に失敗しました。localhost:${target.port} を別のものが使っていないか確認してください`); process.exit(1); }
  // talk to the database we just started, not to whatever else "localhost" (::1) may lead to
  process.env.DATABASE_URL = loopbackUrl(process.env.DATABASE_URL);
  return target;
}

// Why can't we log in? Asks the database from inside its own container with the user / password of DATABASE_URL.
function explainLoginFailure(target) {
  const url = loopbackUrl(process.env.DATABASE_URL).replace(/\?.*$/, ''); // psql does not know Prisma's ?schema=
  const inside = spawnSync('docker', [...COMPOSE, 'exec', '-T', 'db', 'psql', url.replace(/@127\.0\.0\.1:\d+/, '@127.0.0.1:5432'), '-tAc', 'select 1'], { env: composeEnv(target), encoding: 'utf8' });
  console.error('');
  if (inside.status === 0) {
    console.error(`[db] コンテナの中からは、DATABASE_URL のユーザー(${target.user})とパスワードでログインできました。
     つまり、このPCの ${target.port} 番に、別のPostgreSQLが居て応答している可能性があります（IPv6 など）。
     確認:  ss -ltnp | grep ${target.port}     止めるか、.env の DATABASE_URL のポートを変えてください。`);
  } else {
    console.error(`[db] 起動したDBに、DATABASE_URL のユーザー(${target.user})とパスワードではログインできません。
     DBの入れ物(volume)が、前に別のユーザー・パスワードで作られたまま残っているのが原因です。
     作り直す:  npm run db:reset   （開発用DBのデータは消えます）  →  もう一度 npm run seed:demo`);
  }
}

function stopDb(target) {
  say('データベースを止めます（データは残ります）');
  run('docker', [...COMPOSE, 'stop', 'db'], { env: composeEnv(target), stdio: 'ignore' });
}

const started = await startDb();
let stopped = false;
const finish = code => {
  if (started && !stopped) { stopped = true; stopDb(started); }
  process.exit(code);
};

if (migrate) {
  const m = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { encoding: 'utf8' });
  process.stdout.write(m.stdout ?? ''); process.stderr.write(m.stderr ?? '');
  if (m.status !== 0) {
    console.error('[db] マイグレーションに失敗しました');
    // only a failed login (P1000) is explained as one; any other error is shown by prisma above as it is
    if (started && /P1000|Authentication failed/.test(`${m.stdout}${m.stderr}`)) explainLoginFailure(started);
    finish(m.status ?? 1);
  }
}

const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
// Ctrl+C reaches the child too (same terminal group); here we only wait for it, so the database is stopped after it has ended.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { if (!child.killed) child.kill(sig); });
child.on('error', e => { console.error(`[db] ${command[0]} を実行できません: ${e.message}`); finish(127); });
child.on('exit', (code, signal) => finish(code ?? (signal ? 130 : 1)));
