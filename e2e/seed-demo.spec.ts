import { execFileSync } from 'child_process';
import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { BASE_URL, DATABASE_URL, ENCRYPTION_KEY_HEX } from './helpers/constants';
import { db } from './helpers/db';
import { resetSecurity } from './helpers/seed';
import { fakeIp } from './helpers/ui';

// The demo-data script (prisma/seed-demo.mjs) for test servers: it fills every feature, can be run again, and can be removed again.
test.describe.configure({ mode: 'serial' });
const run = (...args: string[]) => execFileSync('node', ['prisma/seed-demo.mjs', ...args], { env: { ...process.env, DATABASE_URL, ENCRYPTION_KEY_HEX, NODE_ENV: 'test' }, encoding: 'utf8' });
const PASSWORD = 'Demo-Passw0rd!';
const count = () => Promise.all([db.users.count({ where: { id: { startsWith: 'demo_' } } }), db.threads.count({ where: { id: { startsWith: 'demo_' } } }), db.todos.count({ where: { id: { startsWith: 'demo_' } } })]);

const opened: APIRequestContext[] = [];
async function loginAs(who: string) {
  const c = await pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': fakeIp() } });
  opened.push(c);
  const res = await c.post('/api/auth/login', { data: { email: `demo-${who}@demo.example.com`, password: PASSWORD } });
  expect(res.status(), `${who} can log in`).toBe(200);
  return c;
}
test.afterAll(async () => { await Promise.all(opened.map(c => c.dispose())); run('--reset'); await resetSecurity(); });

test('デモデータを入れると、全員がパスワードでログインでき、各画面にデータが出る', async () => {
  const out = run('--relax-security');
  expect(out).toContain('デモデータを入れました');
  const [users, threads, todos] = await count();
  expect([users, threads, todos]).toEqual([6, 8, 6]);

  const sato = await loginAs('sato');
  expect((await (await sato.get('/api/threads/unread-counts')).json()).team).toBeGreaterThan(0);
  const mailboxes = (await (await sato.get('/api/mailboxes?mine=1')).json()).items;
  expect(mailboxes.map((m: { display_name: string }) => m.display_name)).toContain('営業チーム共有');
  expect((await (await sato.get('/api/todos?mailboxId=demo_mb_team')).json()).items.length).toBe(6);
  const events = await (await sato.get(`/api/calendar/events?mailboxId=demo_mb_team&from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86400_000).toISOString())}`)).json();
  expect(events.items.length).toBeGreaterThanOrEqual(7);
  const expenses = await (await sato.get('/api/expenses')).json();
  expect(expenses.items.map((x: { status: string }) => x.status).sort()).toEqual(['approved', 'paid', 'pending']);
  expect((await (await sato.get('/api/trips')).json()).items.length).toBe(2);
  expect((await (await sato.get('/api/work/payslips?mine=1')).json()).items.length).toBe(2);
  const account = (await (await sato.get('/api/bank-accounts/me')).json()).account;
  expect(account).toMatchObject({ bank_name: 'みずほ銀行', verified: true });
  expect((await (await sato.get('/api/work/attendance')).json()).records?.length ?? 1).toBeGreaterThan(0);

  const keiri = await loginAs('keiri');
  expect((await keiri.get('/api/transfers/payables?kind=payroll')).status()).toBeLessThan(500);
  expect((await (await keiri.get('/api/payments/vendors')).json()).items.length).toBeGreaterThanOrEqual(2);

  const admin = await loginAs('admin');
  expect((await (await admin.get('/api/org')).json()).units.some((u: { name: string }) => u.name === '営業部')).toBe(true);
  expect((await (await admin.get('/api/evaluations/cycles')).json()).items?.length ?? 2).toBeGreaterThanOrEqual(2);
  for (const who of ['tanaka', 'suzuki', 'yamada']) await loginAs(who);
});

test('もう一度実行しても増えない（同じ id を更新する）。ほかのデータは触らない', async () => {
  const before = await count();
  const others = await db.users.count({ where: { id: { not: { startsWith: 'demo_' } } } });
  run();
  expect(await count()).toEqual(before);
  expect(await db.users.count({ where: { id: { not: { startsWith: 'demo_' } } } })).toBe(others);
});

test('--reset でデモデータだけが消える', async () => {
  const others = await db.users.count({ where: { id: { not: { startsWith: 'demo_' } } } });
  expect(run('--reset')).toContain('デモデータを削除しました');
  expect(await count()).toEqual([0, 0, 0]);
  expect(await db.users.count({ where: { id: { not: { startsWith: 'demo_' } } } })).toBe(others);
  expect(await db.mailboxes.count({ where: { id: { startsWith: 'demo_' } } })).toBe(0);
  expect(await db.payment_requests.count({ where: { id: { startsWith: 'demo_' } } })).toBe(0);
});

test('本番（NODE_ENV=production）では、確認の指定がないと実行しない', async () => {
  expect(() => execFileSync('node', ['prisma/seed-demo.mjs'], { env: { ...process.env, DATABASE_URL, NODE_ENV: 'production' }, encoding: 'utf8', stdio: 'pipe' })).toThrow(/production/);
  expect(await db.users.count({ where: { id: { startsWith: 'demo_' } } })).toBe(0);
});
