import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH, BASE_URL, PASSWORD, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications, resetSecurity } from './helpers/seed';
import { fakeIp } from './helpers/ui';
import { deleteAccountsWithPrefix, newAccount as newAccountIn } from './helpers/accounts';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetSecurity(); await clearNotifications(); await mm.reset(); });
test.afterAll(async () => { await resetSecurity(); });

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const newAccount = () => newAccountIn('acct');
test.afterAll(async () => { await deleteAccountsWithPrefix('acct'); });

const opened: APIRequestContext[] = [];
test.afterEach(async () => { await Promise.all(opened.splice(0).map(c => c.dispose())); });

/** A client that looks like it comes from `ip` (the "proxy" appends exactly one address). */
async function client(ip: string, o: { ua?: string; storageState?: string } = {}) {
  const c = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: o.ua ?? CHROME_WIN, extraHTTPHeaders: { 'x-forwarded-for': ip }, storageState: o.storageState });
  opened.push(c);
  return c;
}
/** A client at `ip` that is signed in from there (a saved session would only work from the address it began on). */
async function signedInAt(ip: string, email: string) { const c = await client(ip); expect((await login(c, email)).status()).toBe(200); return c; }
const login = (c: APIRequestContext, email: string, password = PASSWORD) => c.post('/api/auth/login', { data: { email, password } });
// signed in? (without a session the proxy answers with a redirect to the login page)
const sessionOf = async (c: APIRequestContext) => {
  const res = await c.get('/api/auth/session', { maxRedirects: 0 });
  return res.status() === 200 && (await res.json()).authenticated === true;
};

test.describe('ログインの基本', () => {
  test('パスワード違い・存在しないアカウントは、同じ401と同じ本文', async () => {
    const c = await client(fakeIp());
    const wrong = await login(c, USERS.guest.email, 'wrong-password-1');
    const none = await login(c, 'nobody@e2e.test', 'wrong-password-1');
    expect([wrong.status(), none.status()]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await none.json());
  });

  test('メールアドレスは大文字小文字・前後の空白を無視する', async () => {
    const c = await client(fakeIp());
    expect((await login(c, `  ${USERS.guest.email.toUpperCase()} `)).status()).toBe(200);
    expect(await sessionOf(c)).toBe(true);
  });

  test('入力が壊れている・長すぎるときは400（サーバーを重くさせない）', async () => {
    const c = await client(fakeIp());
    for (const data of [{}, { email: 'a@b.c' }, { email: 'a@b.c', password: { $ne: '' } }, { email: 'a@b.c', password: 'x'.repeat(1001) }]) {
      expect((await c.post('/api/auth/login', { data })).status(), JSON.stringify(data).slice(0, 40)).toBe(400);
    }
  });

  test('成功・失敗がログイン履歴に残り、本人は自分の分だけ見られる', async () => {
    const c = await client(fakeIp());
    await login(c, USERS.guest.email, 'wrong-password-1');
    await login(c, USERS.guest.email);
    const mine = (await (await c.get('/api/security/login-history')).json()).items as { success: boolean; reason: string | null; device: string }[];
    expect(mine.map(l => l.success)).toEqual([true, false]);
    expect(mine[1].reason).toBe('wrong_password');
    expect(mine[0].device).toBe('Chrome（Windows）');
    const other = await client(fakeIp());
    await login(other, USERS.tanaka.email);
    expect(((await (await other.get('/api/security/login-history')).json()).items as unknown[]).length).toBe(1);
  });
});

test.describe('総当たり・スイーピングへの対策', () => {
  test('同じアカウントを同じアドレスから6回試すと429。制限中は正しいパスワードでも通らない', async () => {
    const acct = await newAccount();
    const ip = fakeIp();
    const c = await client(ip);
    for (let i = 0; i < 5; i++) expect((await login(c, acct.email, 'wrong-password-1')).status()).toBe(401);
    const blocked = await login(c, acct.email, 'wrong-password-1');
    expect(blocked.status()).toBe(429);
    expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
    expect((await login(c, acct.email)).status()).toBe(429);
    expect(await sessionOf(c)).toBe(false);
  });

  test('その制限は他のアドレスの本人には及ばない（他人に締め出されない）', async () => {
    const acct = await newAccount();
    const attacker = await client(fakeIp());
    for (let i = 0; i < 6; i++) await login(attacker, acct.email, 'wrong-password-1');
    const owner = await client(fakeIp());
    expect((await login(owner, acct.email)).status()).toBe(200);
  });

  test('X-Forwarded-For の左端に偽のアドレスを書いても、制限を逃れられない', async () => {
    const acct = await newAccount();
    const real = fakeIp();
    let last = 0;
    for (let i = 0; i < 7; i++) {
      const c = await pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': `10.250.${i}.1, ${real}` } });
      opened.push(c);
      last = (await login(c, acct.email, 'wrong-password-1')).status();
    }
    expect(last).toBe(429);
  });

  test('1つのアドレスが短時間に9個の別アカウントを試すとスイーピングとして自動ブロックされ、以後は本物のパスワードでも入れない', async () => {
    const ip = fakeIp();
    const c = await client(ip);
    for (let i = 0; i < 8; i++) expect((await login(c, `victim${i}@e2e.test`, 'wrong-password-1')).status()).toBe(401);
    const stopped = await login(c, 'victim9@e2e.test', 'wrong-password-1');
    expect(stopped.status()).toBe(403);
    expect(await db.ip_blocks.findUnique({ where: { ip } })).toMatchObject({ source: 'auto' });
    expect((await db.security_events.findMany({ where: { type: 'login_sweep' } })).length).toBe(1);
    expect((await login(c, USERS.sato.email)).status()).toBe(403); // even the right password
    expect((await c.get('/login')).status()).toBe(403); // the whole app is closed to that address
    expect((await login(await client(fakeIp()), USERS.sato.email)).status()).toBe(200); // others are unaffected
  });

  test('管理者はブロックを解除でき、解除すればそのアドレスはまた使える', async ({ as }) => {
    const ip = fakeIp();
    const c = await client(ip);
    for (let i = 0; i < 9; i++) await login(c, `sweep${i}@e2e.test`, 'wrong-password-1');
    const block = await db.ip_blocks.findUnique({ where: { ip } });
    expect((await (await as('admin')).delete(`/api/admin/security/blocks/${block!.id}`)).status()).toBe(200);
    expect((await login(c, USERS.sato.email)).status()).toBe(200);
  });

  test('ログインしないまま多数の別ページ・別APIを探ると、スキャンとして429になり、アドレスがブロックされる', async () => {
    const ip = fakeIp();
    const c = await client(ip);
    const paths = ['/wp-admin', '/.env', '/admin/login', '/phpmyadmin', '/api/users', '/api/admin/users', '/api/threads', '/.git/config', '/backup.zip', '/api/work/payslips', '/api/bank-accounts', '/api/transfers/batches', '/config.json', '/server-status', '/api/expenses', '/api/trips'];
    const statuses: number[] = [];
    for (const p of paths) statuses.push((await c.get(p, { maxRedirects: 0 })).status());
    expect(statuses.slice(0, 15).every(s => s === 307)).toBe(true); // just sent to the login page
    expect(statuses[15]).toBe(429);
    expect(await db.ip_blocks.findUnique({ where: { ip } })).toMatchObject({ source: 'auto' });
    expect((await db.security_events.findMany({ where: { type: 'sweep_detected' } })).length).toBeGreaterThan(0);
    expect((await c.get('/login')).status()).toBe(403);
  });

  test('ログイン済みでも、重要なエンドポイントを短時間に叩き続けると429', async () => {
    const acct = await newAccount(); // fresh budget; the minute-long counters can't leak into another test
    const c = await client(fakeIp());
    await login(c, acct.email);
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await c.get('/api/payments/export')).status();
    expect(last).toBe(429);
    expect((await c.get('/api/auth/session')).status()).toBe(200); // other endpoints keep working
  });

  test('ログイン済みの人が、他人のレコードのURLを次々に総当たりすると止まる', async () => {
    const acct = await newAccount();
    const c = await client(fakeIp());
    await login(c, acct.email);
    let blocked = 0;
    for (let i = 0; i < 90; i++) {
      const s = (await c.get(`/api/evaluations/c${String(i).padStart(24, 'x')}`)).status();
      if (s === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect((await db.security_events.findMany({ where: { type: 'sweep_detected', user_id: acct.id } })).length).toBeGreaterThan(0);
  });

  test('接続元のIPアドレスが分からないリクエストは、画面もAPIもログインも拒否され、記録が残る', async () => {
    const bad = await pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': 'not-an-address' } });
    opened.push(bad);
    expect((await bad.get('/login')).status()).toBe(403);
    const api = await bad.post('/api/auth/login', { data: { email: USERS.guest.email, password: PASSWORD } });
    expect(api.status()).toBe(403);
    expect((await api.json()).error).toBe('ip_unknown');
    expect((await bad.get('/api/auth/session')).status()).toBe(403);
    expect((await db.security_events.findMany({ where: { type: 'ip_unknown' } })).length).toBeGreaterThanOrEqual(1);
  });

  test('このマシン自身（ループバック）からのアクセスは、スキャン扱い・自動ブロックの対象にしない', async () => {
    const c = await pwRequest.newContext({ baseURL: BASE_URL }); // no forwarding header: the server sees its own loopback address
    opened.push(c);
    for (let i = 0; i < 20; i++) expect((await c.get(`/p${i}`, { maxRedirects: 0 })).status()).toBe(307);
    expect(await db.ip_blocks.count()).toBe(0);
  });
});

test.describe('新しい端末・Cookie', () => {
  test('最初のログインでは知らせず、別の端末からログインすると本人に通知する（Cookieのある同じ端末では通知しない）', async () => {
    const own = await client(fakeIp());
    expect((await login(own, USERS.guest.email)).status()).toBe(200);
    expect(await mm.quiet(800)).toHaveLength(0); // the first device is the baseline
    expect((await db.known_devices.count({ where: { user_id: USERS.guest.id } }))).toBe(1);

    await login(own, USERS.guest.email); // same browser again
    expect(await mm.quiet(800)).toHaveLength(0);

    const phone = await client(fakeIp(), { ua: SAFARI_IOS });
    await login(phone, USERS.guest.email);
    const posts = await mm.waitFor(p => p.message.includes('新しい端末からログイン'));
    expect(posts.map(p => p.to)).toEqual(['mm-guest']);
    expect(posts[0].message).toContain('Safari（iOS）');
    expect(posts[0].message).not.toContain(PASSWORD);
    expect((await db.security_events.findMany({ where: { type: 'new_device_login' } })).length).toBe(1);
    expect((await db.known_devices.count({ where: { user_id: USERS.guest.id } }))).toBe(2);
  });

  test('通知は設定で止められる', async ({ as }) => {
    const admin = await as('admin');
    const p = await (await admin.get('/api/admin/security/policy')).json();
    await admin.put('/api/admin/security/policy', { data: { allowed_cidrs: '', allowed_countries: '', session_max_days: p.session_max_days, new_device_alert: false, device_binding: false } });
    await login(await client(fakeIp()), USERS.tanaka.email);
    await login(await client(fakeIp(), { ua: SAFARI_IOS }), USERS.tanaka.email);
    expect(await mm.quiet(800)).toHaveLength(0);
  });

  test('端末のCookieは、その人のものしか効かない（他人のCookieを持ち込んでも既知の端末にならない）', async () => {
    const acct = await newAccount();
    const satoBrowser = await client(fakeIp());
    await login(satoBrowser, USERS.guest.email);
    const did = (await satoBrowser.storageState()).cookies.find(c => c.name === 'did')!.value;
    const thief = await pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': fakeIp(), cookie: `did=${did}` } });
    opened.push(thief);
    // for the account-wide limit, the cookie must belong to the account being attacked
    for (let i = 0; i < 16; i++) await login(await client(fakeIp()), acct.email, 'wrong-password-1');
    expect((await login(thief, acct.email, 'wrong-password-1')).status()).toBe(429);
  });

  test('アカウントを狙った攻撃中でも、本人の端末（Cookieあり）はログインできる。Cookieのない端末は止まる', async () => {
    const acct = await newAccount();
    const own = await client(fakeIp());
    expect((await login(own, acct.email)).status()).toBe(200);
    for (let i = 0; i < 16; i++) await login(await client(fakeIp()), acct.email, 'wrong-password-1');
    expect((await login(await client(fakeIp()), acct.email)).status()).toBe(429); // unknown browser
    expect((await login(own, acct.email)).status()).toBe(200); // the person's own browser
  });

  test('制限に達したとき、狙われているアカウントの本人にMattermostで知らせる', async () => {
    const acct = await newAccount();
    const c = await client(fakeIp());
    for (let i = 0; i < 6; i++) await login(c, acct.email, 'wrong-password-1');
    const posts = await mm.waitFor(p => p.message.includes('ログインに繰り返し失敗'));
    expect(posts.map(p => p.to)).toEqual([acct.mm]);
  });
});

test.describe('セッションの管理', () => {
  test('自分のログイン中の端末が一覧でき、現在の端末が分かる', async () => {
    const a = await client(fakeIp());
    const b = await client(fakeIp(), { ua: SAFARI_IOS });
    await login(a, USERS.guest.email); await login(b, USERS.guest.email);
    const items = (await (await a.get('/api/security/sessions')).json()).items as { id: string; device: string; current: boolean; ip: string }[];
    expect(items).toHaveLength(2);
    expect(items.filter(i => i.current).map(i => i.device)).toEqual(['Chrome（Windows）']);
    expect(items.find(i => !i.current)!.device).toBe('Safari（iOS）');
  });

  test('他の端末を1つ終了すると、その端末はログアウトされ、こちらは続く', async () => {
    const a = await client(fakeIp());
    const b = await client(fakeIp());
    await login(a, USERS.guest.email); await login(b, USERS.guest.email);
    const other = ((await (await a.get('/api/security/sessions')).json()).items as { id: string; current: boolean }[]).find(i => !i.current)!;
    expect((await a.delete(`/api/security/sessions/${other.id}`)).status()).toBe(200);
    expect(await sessionOf(b)).toBe(false);
    expect(await sessionOf(a)).toBe(true);
  });

  test('他人のセッションは終了できない（存在しないのと同じ404）', async () => {
    const a = await client(fakeIp());
    const b = await client(fakeIp());
    await login(a, USERS.guest.email); await login(b, USERS.tanaka.email);
    const tanakaSession = ((await (await b.get('/api/security/sessions')).json()).items as { id: string }[])[0];
    expect((await a.delete(`/api/security/sessions/${tanakaSession.id}`)).status()).toBe(404);
    expect(await sessionOf(b)).toBe(true);
  });

  test('「他の端末をすべてログアウト」で、今の端末以外が終了する', async () => {
    const a = await client(fakeIp());
    const others = [await client(fakeIp()), await client(fakeIp())];
    await login(a, USERS.guest.email); for (const o of others) await login(o, USERS.guest.email);
    const res = await (await a.delete('/api/security/sessions')).json();
    expect(res.ended).toBe(2);
    expect(await sessionOf(a)).toBe(true);
    for (const o of others) expect(await sessionOf(o)).toBe(false);
  });

  test('同時にログインできるのは10台まで。11台目でいちばん使っていない端末が終了する', async () => {
    const devices: APIRequestContext[] = [];
    for (let i = 0; i < 11; i++) { const c = await client(fakeIp()); await login(c, USERS.guest.email); devices.push(c); }
    expect((await db.sessions.count({ where: { user_id: USERS.guest.id } }))).toBe(10);
    expect(await sessionOf(devices[0])).toBe(false); // the first one was the least recently used
    expect(await sessionOf(devices[10])).toBe(true);
  });

  test('未ログインは401系（セッション一覧・履歴を見られない）', async () => {
    const c = await client(fakeIp());
    for (const url of ['/api/security/sessions', '/api/security/login-history']) expect([307, 401]).toContain((await c.get(url, { maxRedirects: 0 })).status());
  });

  test('パスワード変更: 弱いパスワード・現在のパスワード違い・同じパスワードは拒否。成功すると他の端末が終了する', async () => {
    await db.users.update({ where: { id: USERS.guest.id }, data: {} });
    const a = await client(fakeIp());
    const b = await client(fakeIp());
    await login(a, USERS.guest.email); await login(b, USERS.guest.email);
    const change = (current: string, next: string) => a.post('/api/profile/password', { data: { currentPassword: current, newPassword: next } });
    expect((await change('wrong-current-pw', 'Tr0ub4dor-9x-Pw')).status()).toBe(400);
    const weak = await change(PASSWORD, 'short1!');
    expect(weak.status()).toBe(400);
    expect((await weak.json()).error).toBe('password_weak');
    expect((await change(PASSWORD, 'Password12345')).status()).toBe(400);
    expect((await change(PASSWORD, PASSWORD)).status()).toBe(400);
    const ok = await change(PASSWORD, 'Tr0ub4dor-9x-Pw');
    expect(ok.status()).toBe(200);
    expect((await ok.json()).sessions_ended).toBe(1);
    expect(await sessionOf(b)).toBe(false);
    expect(await sessionOf(a)).toBe(true);
    expect((await login(await client(fakeIp()), USERS.guest.email, 'Tr0ub4dor-9x-Pw')).status()).toBe(200);
    // put the original password back for the other specs
    const { hashPassword } = await import('../src/lib/password');
    await db.users.update({ where: { id: USERS.guest.id }, data: { password_hash: await hashPassword(PASSWORD, { N: 1024 }) } });
  });

  test('パスワード変更の試行は回数が制限される（乗っ取られた画面での推測を防ぐ）', async () => {
    const a = await client(fakeIp());
    await login(a, USERS.guest.email);
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await a.post('/api/profile/password', { data: { currentPassword: `guess-number-${i}`, newPassword: 'Tr0ub4dor-9x-Pw' } })).status();
    expect(last).toBe(429);
  });
});

test.describe('アカウントのロック（管理者）', () => {
  test('ロックすると全端末がログアウトされ、ログインできない。解除すれば入れる', async ({ as }) => {
    const admin = await as('admin');
    const victim = await client(fakeIp());
    await login(victim, USERS.guest.email);
    const res = await admin.post(`/api/admin/security/users/${USERS.guest.id}/lock`, { data: { locked: true } });
    expect((await res.json()).ended).toBe(1);
    expect(await sessionOf(victim)).toBe(false);
    const retry = await login(await client(fakeIp()), USERS.guest.email);
    expect(retry.status()).toBe(401);
    expect(await retry.json()).toEqual({ error: 'unauthorized' }); // the same answer as for a wrong password
    expect((await db.login_logs.findFirst({ where: { failure_reason: 'account_locked' } }))).not.toBeNull();
    await admin.post(`/api/admin/security/users/${USERS.guest.id}/lock`, { data: { locked: false } });
    expect((await login(await client(fakeIp()), USERS.guest.email)).status()).toBe(200);
  });

  test('自分自身・最後の管理者はロックできない。管理者以外は操作できない', async ({ as }) => {
    const admin = await as('admin');
    expect((await admin.post(`/api/admin/security/users/${USERS.admin.id}/lock`, { data: { locked: true } })).status()).toBe(409);
    await db.users.update({ where: { id: USERS.admin2.id }, data: { role: 'user' } });
    try {
      expect((await (await as('admin2')).post(`/api/admin/security/users/${USERS.admin.id}/lock`, { data: { locked: true } })).status()).toBe(403);
    } finally { await db.users.update({ where: { id: USERS.admin2.id }, data: { role: 'admin' } }); }
    expect((await (await as('sato')).post(`/api/admin/security/users/${USERS.guest.id}/lock`, { data: { locked: true } })).status()).toBe(403);
  });

  test('ロックしたユーザーのパスキーでも入れない・既存のCookieも効かない', async ({ as }) => {
    const victim = await client(fakeIp());
    await login(victim, USERS.guest.email);
    await db.users.update({ where: { id: USERS.guest.id }, data: { locked_at: new Date() } }); // locked without ending sessions
    expect(await sessionOf(victim)).toBe(false); // the cookie itself no longer works
    void as;
  });

  test('管理者がユーザーの全セッションを終了できる', async ({ as }) => {
    const c = await client(fakeIp());
    await login(c, USERS.guest.email);
    const res = await (await as('admin')).delete(`/api/admin/security/sessions?userId=${USERS.guest.id}`);
    expect((await res.json()).ended).toBe(1);
    expect(await sessionOf(c)).toBe(false);
  });
});

test.describe('アクセス元の制限（管理者）', () => {
  const policy = (extra: object = {}) => ({ allowed_cidrs: '', allowed_countries: '', session_max_days: 14, new_device_alert: true, device_binding: false, ...extra });

  test('許可ネットワークに自分のアドレスが入っていない設定は保存できない（自分を締め出さない）', async () => {
    const admin = await signedInAt('10.77.0.5', USERS.admin.email);
    const res = await admin.put('/api/admin/security/policy', { data: policy({ allowed_cidrs: '192.168.50.0/24' }) });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe('locks_yourself_out');
    expect((await admin.put('/api/admin/security/policy', { data: policy({ allowed_cidrs: 'not an address' }) })).status()).toBe(400);
  });

  test('許可ネットワークを設定すると、外のアドレスからはログインも利用もできず、中なら使える。解除すると戻る', async () => {
    const admin = await signedInAt('10.77.0.5', USERS.admin.email);
    expect((await admin.put('/api/admin/security/policy', { data: policy({ allowed_cidrs: '10.77.0.0/16  # 本社' }) })).status()).toBe(200);
    const outside = await client('10.88.0.9');
    expect((await login(outside, USERS.sato.email)).status()).toBe(403);
    expect((await outside.get('/login')).status()).toBe(403);
    const inside = await client('10.77.3.3');
    expect((await login(inside, USERS.sato.email)).status()).toBe(200);
    expect(await sessionOf(inside)).toBe(true);
    // an existing session is also cut off when it is used from outside the allowed networks
    const stolen = await client('10.88.0.9', { storageState: AUTH.keiri });
    expect((await stolen.get('/api/work/me', { maxRedirects: 0 })).status()).toBe(403);
    expect((await admin.put('/api/admin/security/policy', { data: policy() })).status()).toBe(200);
    expect((await login(outside, USERS.sato.email)).status()).toBe(200);
  });

  test('手動ブロック: 範囲を指定でき、自分のアドレスはブロックできず、解除できる', async () => {
    const admin = await signedInAt('10.77.0.5', USERS.admin.email);
    expect((await admin.post('/api/admin/security/blocks', { data: { ip: '10.77.0.0/24', reason: 'テスト' } })).status()).toBe(409); // includes the admin's own address
    expect((await admin.post('/api/admin/security/blocks', { data: { ip: 'garbage', reason: 'x' } })).status()).toBe(400);
    expect((await admin.post('/api/admin/security/blocks', { data: { ip: '10.99.0.0/24', reason: '不審なアクセス' } })).status()).toBe(201);
    expect((await (await client('10.99.0.44')).get('/login')).status()).toBe(403);
    expect((await (await client('10.99.1.44')).get('/login')).status()).toBe(200);
    const block = await db.ip_blocks.findFirst({ where: { ip: '10.99.0.0/24' } });
    expect((await admin.delete(`/api/admin/security/blocks/${block!.id}`)).status()).toBe(200);
    expect((await (await client('10.99.0.44')).get('/login')).status()).toBe(200);
  });

  test('期限つきのブロックは、期限が過ぎると効かなくなる', async () => {
    const admin = await signedInAt('10.77.0.5', USERS.admin.email);
    await db.ip_blocks.create({ data: { ip: '10.66.0.1', reason: '期限切れ', source: 'manual', expires_at: new Date(Date.now() - 1000) } });
    await admin.post('/api/admin/security/blocks', { data: { ip: '10.66.0.2', reason: 'x', minutes: 5 } });
    expect((await (await client('10.66.0.1')).get('/login')).status()).toBe(200);
    expect((await (await client('10.66.0.2')).get('/login')).status()).toBe(403);
  });
});

test.describe('Cookieの使い回し・セッションの寿命', () => {
  test('端末の確認をオンにすると、別の種類の端末にCookieを持ち込んでも使えず、元の端末は使える', async () => {
    // a session of its own: the saved one was made by another kind of client and would itself be ended once the check is on
    const admin = await client(fakeIp());
    await login(admin, USERS.admin.email);
    const p = await (await admin.get('/api/admin/security/policy')).json();
    await admin.put('/api/admin/security/policy', { data: { allowed_cidrs: '', allowed_countries: '', session_max_days: p.session_max_days, new_device_alert: false, device_binding: true } });
    try {
      const ownerIp = fakeIp();
      const owner = await client(ownerIp);
      await login(owner, USERS.guest.email);
      const cookies = (await owner.storageState()).cookies.filter(c => c.name === 'sid');
      const thief = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: SAFARI_IOS, extraHTTPHeaders: { 'x-forwarded-for': ownerIp, cookie: `sid=${cookies[0].value}` } });
      opened.push(thief);
      expect(await sessionOf(thief)).toBe(false);
      expect((await db.security_events.findMany({ where: { type: 'session_device_mismatch' } })).length).toBe(1);
      expect(await sessionOf(owner)).toBe(false); // the stolen session is ended for everyone: the real owner logs in again
      expect((await login(owner, USERS.guest.email)).status()).toBe(200);
      expect(await sessionOf(owner)).toBe(true);
      // a browser update (new version, same browser and OS) does not log anybody out
      const updated = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME_WIN.replace('126.0.0.0', '131.0.0.0'), extraHTTPHeaders: { 'x-forwarded-for': ownerIp, cookie: `sid=${(await owner.storageState()).cookies.find(c => c.name === 'sid')!.value}` } });
      opened.push(updated);
      expect(await sessionOf(updated)).toBe(true);
    } finally {
      await admin.put('/api/admin/security/policy', { data: { allowed_cidrs: '', allowed_countries: '', session_max_days: p.session_max_days, new_device_alert: true, device_binding: false } });
    }
  });

  test('セッションは、ログインしたIPアドレスからしか使えない。別のアドレスから使うとセッションごと終了する', async () => {
    const ip = fakeIp();
    const owner = await signedInAt(ip, USERS.guest.email);
    expect(await sessionOf(owner)).toBe(true);
    const sid = (await owner.storageState()).cookies.find(c => c.name === 'sid')!.value;

    const elsewhere = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME_WIN, extraHTTPHeaders: { 'x-forwarded-for': fakeIp(), cookie: `sid=${sid}` } });
    opened.push(elsewhere);
    expect(await sessionOf(elsewhere)).toBe(false);
    expect((await elsewhere.get('/api/threads', { maxRedirects: 0 })).status()).not.toBe(200);
    const events = await db.security_events.findMany({ where: { type: 'session_ip_mismatch', user_id: USERS.guest.id } });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].severity).toBe('warn');

    // the session is gone for good: the real owner is signed out too, and logs in again
    expect(await sessionOf(owner)).toBe(false);
    expect(await db.sessions.count({ where: { id: { not: '' }, user_id: USERS.guest.id, ip_address: ip } })).toBe(0);
    expect((await login(owner, USERS.guest.email)).status()).toBe(200);
    expect(await sessionOf(owner)).toBe(true);
  });

  test('同じアドレスなら使い続けられる。IPv6は、同じ回線（先頭64ビット）の中で下位が変わっても外れない', async () => {
    const ip = fakeIp();
    const c = await signedInAt(ip, USERS.guest.email);
    const sid = (await c.storageState()).cookies.find(c2 => c2.name === 'sid')!.value;
    const same = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME_WIN, extraHTTPHeaders: { 'x-forwarded-for': ip, cookie: `sid=${sid}` } });
    opened.push(same);
    expect(await sessionOf(same)).toBe(true);

    const v6 = await signedInAt('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd', USERS.guest.email);
    const sid6 = (await v6.storageState()).cookies.find(c2 => c2.name === 'sid')!.value;
    const rotated = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME_WIN, extraHTTPHeaders: { 'x-forwarded-for': '2001:db8:1234:5678:1111:2222:3333:4444', cookie: `sid=${sid6}` } });
    opened.push(rotated);
    expect(await sessionOf(rotated)).toBe(true);
    const otherLine = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME_WIN, extraHTTPHeaders: { 'x-forwarded-for': '2001:db8:1234:9999:aaaa:bbbb:cccc:dddd', cookie: `sid=${sid6}` } });
    opened.push(otherLine);
    expect(await sessionOf(otherLine)).toBe(false);
  });

  test('画面（ブラウザ）でも、別のアドレスから開くとログイン画面に戻される', async ({ browser }) => {
    const ip = fakeIp();
    const c = await signedInAt(ip, USERS.guest.email);
    const sid = (await c.storageState()).cookies.find(k => k.name === 'sid')!.value;
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': fakeIp() } });
    await ctx.addCookies([{ name: 'sid', value: sid, url: BASE_URL }]);
    const page = await ctx.newPage();
    await page.goto('/threads');
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });

  test('役割はCookieではなくDBから決まる: 管理者から降格すると、すぐに管理画面のAPIに入れなくなる', async () => {
    const c = await client(fakeIp());
    await login(c, USERS.admin2.email);
    expect((await c.get('/api/admin/security/overview')).status()).toBe(200);
    await db.users.update({ where: { id: USERS.admin2.id }, data: { role: 'user' } });
    try {
      expect((await c.get('/api/admin/security/overview')).status()).toBe(403);
      expect((await (await c.get('/api/auth/session')).json()).user.role).toBe('user');
    } finally { await db.users.update({ where: { id: USERS.admin2.id }, data: { role: 'admin' } }); }
  });

  test('ログインのたびに新しいセッションIDになる（セッション固定攻撃への備え）', async () => {
    const c = await client(fakeIp());
    await login(c, USERS.guest.email);
    const first = (await (await c.get('/api/security/sessions')).json()).items[0].id;
    await login(c, USERS.guest.email);
    const ids = ((await (await c.get('/api/security/sessions')).json()).items as { id: string; current: boolean }[]);
    expect(ids.find(i => i.current)!.id).not.toBe(first);
  });
});

test.describe('他サイトからのリクエスト・ヘッダー', () => {
  test('他のサイトを名乗る更新リクエスト（CSRF）は拒否され、記録される。自分のサイトからは通る', async () => {
    const c = await client(fakeIp());
    await login(c, USERS.guest.email);
    const evil = await c.post('/api/security/sessions', { headers: { origin: 'https://evil.example' }, data: {} });
    expect(evil.status()).toBe(403);
    expect((await evil.json()).error).toBe('bad_origin');
    expect((await c.delete('/api/security/sessions', { headers: { origin: 'null' } })).status()).toBe(403);
    expect((await db.security_events.findMany({ where: { type: 'bad_origin' } })).length).toBe(2);
    expect((await c.delete('/api/security/sessions', { headers: { origin: BASE_URL } })).status()).toBe(200);
    expect((await c.get('/api/security/sessions', { headers: { origin: 'https://evil.example' } })).status()).toBe(200); // reading is not a change
  });

  test('セキュリティヘッダーが付き、個人情報のAPIはキャッシュされない', async () => {
    const c = await signedInAt(fakeIp(), USERS.guest.email);
    const page = await c.get('/login');
    const h = page.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['cross-origin-resource-policy']).toBe('same-origin');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['x-powered-by']).toBeUndefined();
    expect((await c.get('/api/security/sessions')).headers()['cache-control']).toContain('no-store');
  });
});

test.describe('管理者の画面・権限', () => {
  test('管理者以外はセキュリティのAPIを使えない', async ({ as }) => {
    for (const r of ['sato', 'keiri'] as const) {
      const c = await as(r);
      expect((await c.get('/api/admin/security/overview')).status(), r).toBe(403);
      expect((await c.get('/api/admin/security/policy')).status(), r).toBe(403);
      expect((await c.post('/api/admin/security/blocks', { data: { ip: '10.1.1.1', reason: 'x' } })).status(), r).toBe(403);
      expect((await c.delete('/api/admin/security/sessions?userId=u_sato')).status(), r).toBe(403);
    }
  });

  test('概要に失敗の多いアドレス・狙われたアカウント・検知したできごとが出る', async ({ as }) => {
    const ip = fakeIp();
    const c = await client(ip);
    for (let i = 0; i < 4; i++) await login(c, USERS.sato.email, 'wrong-password-1');
    for (let i = 0; i < 9; i++) await login(await client(fakeIp()), `scan${i}@e2e.test`, 'x'); // different addresses: no sweep
    const o = await (await (await as('admin')).get('/api/admin/security/overview')).json();
    expect(o.summary.failed_24h).toBeGreaterThanOrEqual(13);
    expect(o.top_ips[0]).toEqual({ key: ip, count: 4 });
    expect(o.top_accounts[0]).toEqual({ key: USERS.sato.email, count: 4 });
    expect(Array.isArray(o.events)).toBe(true);
    expect(o.recent_logins.length).toBeGreaterThan(0);
  });

  test('ユーザーの人事・口座などの情報は概要に含まれない', async ({ as }) => {
    const o = JSON.stringify(await (await (await as('admin')).get('/api/admin/security/overview')).json());
    expect(o).not.toContain('password_hash');
    expect(o).not.toContain(PASSWORD);
  });
});

test.describe('画面', () => {
  test('プロフィールに、ログイン中の端末とログイン履歴が出て、他の端末を終了できる', async ({ browser }) => {
    const other = await client(fakeIp(), { ua: SAFARI_IOS });
    await login(other, USERS.guest.email);
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': fakeIp() } });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.fill('#email', USERS.guest.email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/threads/);
    await page.goto('/profile');
    const section = page.getByLabel('セキュリティ', { exact: true });
    await expect(section.getByText('この端末')).toBeVisible();
    await expect(section.getByText('Safari（iOS）').first()).toBeVisible();
    await expect(section.getByText('成功').first()).toBeVisible();
    page.once('dialog', d => d.accept());
    await section.getByRole('button', { name: /他の\d+台をすべてログアウト/ }).click();
    await expect(page.getByRole('status')).toContainText('終了しました');
    expect(await sessionOf(other)).toBe(false);
    await ctx.close();
  });

  test.describe('管理者', () => {
    test.use({ storageState: AUTH.admin });

    test('セキュリティ画面に概要・ブロック・条件・検知したできごとが出る', async ({ page }) => {
      await page.goto('/admin/security');
      await expect(page.getByRole('heading', { level: 1, name: 'セキュリティ' })).toBeVisible();
      for (const name of ['ブロック中のアドレス', 'セキュリティイベント', 'アクセスの条件', '最近のログイン']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
      await expect(page.getByText('ログイン失敗（24時間）')).toBeVisible();
    });

    test('画面からアドレスをブロック・解除でき、自分のアドレスは拒否される', async ({ page }) => {
      await page.goto('/admin/security');
      const blocks = page.getByLabel('ブロック中のアドレス', { exact: true });
      await blocks.getByPlaceholder(/203\.0\.113\.7/).fill('10.123.0.0/24');
      await blocks.locator('input').nth(1).fill('不審なアクセス');
      await blocks.getByRole('button', { name: 'ブロック', exact: true }).click();
      await expect(blocks.getByText('10.123.0.0/24')).toBeVisible();
      expect(await db.ip_blocks.count({ where: { ip: '10.123.0.0/24' } })).toBe(1);
      await blocks.getByRole('button', { name: '10.123.0.0/24のブロックを解除' }).click();
      await expect(blocks.getByText('10.123.0.0/24')).toHaveCount(0);
      await blocks.getByPlaceholder(/203\.0\.113\.7/).fill('not an address');
      await blocks.locator('input').nth(1).fill('x');
      await blocks.getByRole('button', { name: 'ブロック', exact: true }).click();
      await expect(blocks.getByRole('status')).toContainText('書式');
    });

    test('許可ネットワークに自分のアドレスがないと保存できず、理由が出る', async ({ page }) => {
      await page.goto('/admin/security');
      const policy = page.getByLabel('アクセスの条件', { exact: true });
      await policy.locator('textarea').fill('192.0.2.0/24');
      await policy.getByRole('button', { name: '保存' }).click();
      await expect(policy.getByRole('status')).toContainText('あなた自身がログインできなくなります');
    });

    test('メニューの「セキュリティ」から開ける', async ({ page }) => {
      await page.goto('/threads');
      await page.locator('header').getByRole('button', { name: 'アカウントメニュー' }).click();
      await page.locator('header').getByRole('link', { name: /^セキュリティ/ }).click();
      await expect(page).toHaveURL(/\/admin\/security/);
    });
  });

  test.describe('一般ユーザー', () => {
    test.use({ storageState: AUTH.sato });
    test('セキュリティ管理画面には入れず、メニューにも出ない', async ({ page }) => {
      await page.goto('/admin/security');
      await expect(page).not.toHaveURL(/\/admin\/security/);
      await page.locator('header').getByRole('button', { name: 'アカウントメニュー' }).click();
      await expect(page.locator('header').getByRole('link', { name: /^セキュリティ/ })).toHaveCount(0);
    });
  });
});
