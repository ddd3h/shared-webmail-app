// How many SQL statements does a screen cost? Run a dev server with PRISMA_LOG_QUERIES=1 (stdout -> a file), then:
//   node scripts/measure-queries.mjs http://localhost:3100 /tmp/server.log scenarios.json [email] [password]
// scenarios.json: [{ "name": "ユーザー画面", "requests": [["GET", "/api/users"]] }, ...]
// Logs in (as an administrator), then for every scenario counts the statements the server printed while its requests ran.
import { readFileSync } from 'node:fs';

const [base, logFile, scenarioFile, email = 'admin@e2e.test', password = 'E2ePassw0rd!'] = process.argv.slice(2);
if (!base || !logFile || !scenarioFile) { console.error('usage: node scripts/measure-queries.mjs <baseUrl> <serverLog> <scenarios.json> [email] [password]'); process.exit(2); }

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const headers = { 'user-agent': UA, 'x-forwarded-for': '198.51.100.201', 'content-type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const statements = () => readFileSync(logFile, 'utf8').split('\n').filter(l => l.includes('prisma:query')).length;

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
if (!login.ok) { console.error('login failed', login.status, await login.text()); process.exit(1); }
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

const scenarios = JSON.parse(readFileSync(scenarioFile, 'utf8'));
// Every scenario runs several times. The first pass warms the dev server up (compiling a route costs time, not statements); of the
// others the smallest count is reported, so the server's own background jobs (mail sync, scheduled sends) do not blur the picture.
const PASSES = 5;
const runs = scenarios.map(() => []);
for (let pass = 0; pass < PASSES; pass++) {
  for (const [i, s] of scenarios.entries()) {
    await sleep(300);
    const before = statements();
    const t0 = performance.now();
    for (const [method, path] of s.requests) {
      const res = await fetch(`${base}${path}`, { method, headers: { ...headers, cookie }, redirect: 'manual' });
      await res.arrayBuffer();
      if (pass === 0 && (res.status >= 400 || res.status === 307)) console.error(`  ! ${method} ${path} -> ${res.status}`);
    }
    const ms = Math.round(performance.now() - t0);
    await sleep(500);
    if (pass > 0) runs[i].push({ queries: statements() - before, ms });
  }
}
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = scenarios.map((s, i) => ({ name: s.name, requests: s.requests.length, queries: Math.min(...runs[i].map(r => r.queries)), ms: median(runs[i].map(r => r.ms)) }));
console.log('画面'.padEnd(34) + 'API数  SQL数  時間(ms)');
for (const r of rows) console.log(r.name.padEnd(34) + String(r.requests).padStart(4) + String(r.queries).padStart(7) + String(r.ms).padStart(9));
console.log('合計'.padEnd(34) + String(rows.reduce((a, r) => a + r.requests, 0)).padStart(4) + String(rows.reduce((a, r) => a + r.queries, 0)).padStart(7) + String(rows.reduce((a, r) => a + r.ms, 0)).padStart(9));
