import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH, BASE_URL, PASSWORD } from './helpers/constants';
import { db } from './helpers/db';
import { deleteAccountsWithPrefix, newAccount as newAccountIn } from './helpers/accounts';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications, resetSecurity } from './helpers/seed';
import { fakeIp, freshContext } from './helpers/ui';
import { base32Decode, codeForStep, stepAt } from '../src/lib/totp';

test.describe.configure({ mode: 'serial' });
const newAccount = () => newAccountIn('mfa');

let adminApi: APIRequestContext;
const setRule = (on: boolean, trustDays?: number) => adminApi.put('/api/admin/security/policy', { data: { allowed_cidrs: '', allowed_countries: '', session_max_days: 14, new_device_alert: false, device_binding: false, require_2fa: on, ...(trustDays === undefined ? {} : { mfa_trust_days: trustDays }) } });

test.beforeAll(async ({ playwright }) => { adminApi = await playwright.request.newContext({ baseURL: BASE_URL, storageState: AUTH.admin }); });
test.beforeEach(async () => { await resetSecurity(); await clearNotifications(); await mm.reset(); expect((await setRule(true, 30)).status()).toBe(200); });
test.afterAll(async () => { await resetSecurity(); await deleteAccountsWithPrefix('mfa'); await adminApi.dispose(); });

const opened: APIRequestContext[] = [];
test.afterEach(async () => { await Promise.all(opened.splice(0).map(c => c.dispose())); });

async function client(ip = fakeIp()) {
  const c = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36', extraHTTPHeaders: { 'x-forwarded-for': ip } });
  opened.push(c);
  return c;
}
const login = (c: APIRequestContext, email: string, password = PASSWORD) => c.post('/api/auth/login', { data: { email, password } });
const post = (c: APIRequestContext, url: string, data: unknown) => c.post(url, { data });
const signedIn = async (c: APIRequestContext) => { const r = await c.get('/api/auth/session', { maxRedirects: 0 }); return r.status() === 200 && (await r.json()).authenticated === true; };

/** The 6 digits the person's app shows right now. (Forgets the last accepted step first, so tests can log in several times within one 30-second step.) */
async function codeNow(secret: string, userId: string) {
  await db.users.update({ where: { id: userId }, data: { totp_last_step: null } });
  return codeForStep(base32Decode(secret)!, stepAt(Date.now()));
}

/** An account that already has the second factor on. */
async function accountWithMfa() {
  const acct = await newAccount();
  const c = await client();
  const first = await (await login(c, acct.email)).json();
  const setup = await (await post(c, '/api/auth/mfa/setup', { challenge: first.challenge })).json();
  const done = await post(c, '/api/auth/mfa/enable', { setup_token: setup.setup_token, code: await codeNow(setup.secret, acct.id) });
  expect(done.status()).toBe(200);
  const recovery = (await done.json()).recovery_codes as string[];
  return { ...acct, secret: setup.secret as string, recovery };
}

test.describe('パスキーか、パスワード＋2段階認証', () => {
  test('ルールがオンで、2段階認証が未設定の人は、パスワードだけではログインできない（設定へ案内される）', async () => {
    const acct = await newAccount();
    const c = await client();
    const res = await login(c, acct.email);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.mfa_setup_required).toBe(true);
    expect(typeof body.challenge).toBe('string');
    expect(await signedIn(c)).toBe(false); // no session was made
    expect((await c.storageState()).cookies.some(k => k.name === 'sid')).toBe(false);
  });

  test('設定: QRコードと設定キーが返り、正しいコードで有効になってログインが完了し、回復コードが10個出る', async () => {
    const acct = await newAccount();
    const c = await client();
    const { challenge } = await (await login(c, acct.email)).json();
    const setup = await (await post(c, '/api/auth/mfa/setup', { challenge })).json();
    expect(setup.qr).toMatch(/^data:image\/png;base64,/);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.uri).toContain(`secret=${setup.secret}`);
    expect(setup.uri).toContain(encodeURIComponent(acct.email));
    expect(await db.users.findUnique({ where: { id: acct.id } })).toMatchObject({ totp_enabled_at: null, totp_secret_enc: null }); // nothing saved until a code was confirmed

    const done = await post(c, '/api/auth/mfa/enable', { setup_token: setup.setup_token, code: await codeNow(setup.secret, acct.id) });
    expect(done.status()).toBe(200);
    const body = await done.json();
    expect(body.recovery_codes).toHaveLength(10);
    expect(await signedIn(c)).toBe(true);
    const row = await db.users.findUnique({ where: { id: acct.id } });
    expect(row!.totp_enabled_at).not.toBeNull();
    expect(row!.totp_secret_enc).not.toContain(setup.secret); // stored encrypted
    const hashes = await db.recovery_codes.findMany({ where: { user_id: acct.id } });
    expect(hashes).toHaveLength(10);
    for (const code of body.recovery_codes) expect(hashes.some(h => h.code_hash === code || h.code_hash.includes(code))).toBe(false); // only hashes are stored
  });

  test('設定で間違ったコードを入れても有効にならず、ログインも完了しない', async () => {
    const acct = await newAccount();
    const c = await client();
    const { challenge } = await (await login(c, acct.email)).json();
    const setup = await (await post(c, '/api/auth/mfa/setup', { challenge })).json();
    const res = await post(c, '/api/auth/mfa/enable', { setup_token: setup.setup_token, code: '000000' });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('invalid_code');
    expect(await signedIn(c)).toBe(false);
    expect((await db.users.findUnique({ where: { id: acct.id } }))!.totp_enabled_at).toBeNull();
  });

  test('有効な人は、パスワードのあとにコードが必要。コードが合うまでセッションはできない', async () => {
    const acct = await accountWithMfa();
    const c = await client();
    const step1 = await (await login(c, acct.email)).json();
    expect(step1.mfa_required).toBe(true);
    expect(step1.challenge).toBeTruthy();
    expect(await signedIn(c)).toBe(false);
    const wrong = await post(c, '/api/auth/mfa/verify', { challenge: step1.challenge, code: '123456' });
    expect(wrong.status()).toBe(401);
    expect((await wrong.json()).error).toBe('invalid_code');
    expect(await signedIn(c)).toBe(false);
    expect(await db.login_logs.count({ where: { user_id: acct.id, failure_reason: 'wrong_2fa' } })).toBe(1);
    const ok = await post(c, '/api/auth/mfa/verify', { challenge: step1.challenge, code: await codeNow(acct.secret, acct.id) });
    expect(ok.status()).toBe(200);
    expect(await signedIn(c)).toBe(true);
  });

  test('パスワードが違えば、第2段階には進めない（案内も出ない）', async () => {
    const acct = await accountWithMfa();
    const res = await login(await client(), acct.email, 'wrong-password-1');
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  test('一度使ったコードは、同じ30秒のうちは二度と使えない', async () => {
    const acct = await accountWithMfa();
    const code = await codeNow(acct.secret, acct.id);
    const first = await client();
    const a = await (await login(first, acct.email)).json();
    expect((await post(first, '/api/auth/mfa/verify', { challenge: a.challenge, code })).status()).toBe(200);
    const second = await client();
    const b = await (await login(second, acct.email)).json();
    expect((await post(second, '/api/auth/mfa/verify', { challenge: b.challenge, code })).status()).toBe(401); // the very same code, a moment later
    expect(await signedIn(second)).toBe(false);
  });

  test('コードを5回間違えると、正しいコードでも入れなくなる（429）。本人に伝わる', async () => {
    const acct = await accountWithMfa();
    const c = await client();
    const { challenge } = await (await login(c, acct.email)).json();
    for (let i = 0; i < 5; i++) expect((await post(c, '/api/auth/mfa/verify', { challenge, code: '000000' })).status()).toBe(401);
    const blocked = await post(c, '/api/auth/mfa/verify', { challenge, code: await codeNow(acct.secret, acct.id) });
    expect(blocked.status()).toBe(429);
    expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
    expect(await signedIn(c)).toBe(false);
    expect((await db.security_events.findMany({ where: { type: 'mfa_locked', user_id: acct.id } })).length).toBe(1);
  });

  test('チャレンジは偽造・改ざんできず、別の用途には使えない', async () => {
    const acct = await accountWithMfa();
    const c = await client();
    const login1 = await (await login(c, acct.email)).json();
    const code = await codeNow(acct.secret, acct.id);
    for (const challenge of ['', 'garbage', login1.challenge.slice(0, -4) + 'AAAA', null, 42, { a: 1 }]) {
      expect((await post(c, '/api/auth/mfa/verify', { challenge, code })).status(), String(challenge).slice(0, 20)).toBe(401);
    }
    expect((await post(c, '/api/auth/mfa/setup', { challenge: login1.challenge })).status()).toBe(401); // a "code" challenge is not a "setup" challenge
    expect((await post(c, '/api/auth/mfa/enable', { setup_token: login1.challenge, code })).status()).toBe(401);
    expect(await signedIn(c)).toBe(false);
  });

  test('すでに有効な人が、設定のやり直し（別の鍵への差し替え）を第三者に仕掛けることはできない', async () => {
    const acct = await accountWithMfa();
    const c = await client();
    const { challenge } = await (await login(c, acct.email)).json(); // password right, second step pending
    expect((await post(c, '/api/auth/mfa/setup', { challenge })).status()).toBe(401);
  });

  test('ロックされたアカウントは、第2段階も通らない', async () => {
    const acct = await accountWithMfa();
    const c = await client();
    const { challenge } = await (await login(c, acct.email)).json();
    await db.users.update({ where: { id: acct.id }, data: { locked_at: new Date() } });
    expect((await post(c, '/api/auth/mfa/verify', { challenge, code: await codeNow(acct.secret, acct.id) })).status()).toBe(401);
    expect(await signedIn(c)).toBe(false);
  });

  test('ルールをオフにすると、パスワードだけでログインできる（管理者の判断で戻せる）。オフにしたことは警告として記録される', async () => {
    const acct = await accountWithMfa();
    expect((await setRule(false)).status()).toBe(200);
    const c = await client();
    expect((await (await login(c, acct.email)).json()).ok).toBe(true);
    expect(await signedIn(c)).toBe(true);
    const events = await db.security_events.findMany({ where: { type: 'policy_2fa_off' } });
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('alert');
  });

  test('ルールの変更は管理者だけができる', async ({ as }) => {
    const res = await (await as('sato')).put('/api/admin/security/policy', { data: { allowed_cidrs: '', allowed_countries: '', session_max_days: 14, new_device_alert: false, device_binding: false, require_2fa: false } });
    expect(res.status()).toBe(403);
    expect((await (await adminApi.get('/api/admin/security/policy')).json()).require_2fa).toBe(true);
  });
});

test.describe('回復コード', () => {
  test('回復コードでログインでき、1つにつき1回だけ。使うと本人に通知される', async () => {
    const acct = await accountWithMfa();
    const code = acct.recovery[0];
    const a = await client();
    const step = await (await login(a, acct.email)).json();
    expect((await post(a, '/api/auth/mfa/verify', { challenge: step.challenge, code: code.toUpperCase().replace('-', ' ') })).status()).toBe(200); // case / spaces / dash don't matter
    expect(await signedIn(a)).toBe(true);
    const b = await client();
    const again = await (await login(b, acct.email)).json();
    expect((await post(b, '/api/auth/mfa/verify', { challenge: again.challenge, code })).status()).toBe(401);
    const posts = await mm.waitFor(p => p.message.includes('回復コードが使われました'));
    expect(posts.map(p => p.to)).toEqual([acct.mm]);
    expect(posts[0].message).not.toContain(code);
    expect((await db.recovery_codes.count({ where: { user_id: acct.id, used_at: null } }))).toBe(9);
    expect((await db.security_events.findMany({ where: { type: 'mfa_recovery_used' } })).length).toBe(1);
  });

  test('同じ回復コードを同時に使っても、1回しか通らない', async () => {
    const acct = await accountWithMfa();
    const code = acct.recovery[1];
    const [a, b] = [await client(), await client()];
    const [ca, cb] = [await (await login(a, acct.email)).json(), await (await login(b, acct.email)).json()];
    const results = await Promise.all([post(a, '/api/auth/mfa/verify', { challenge: ca.challenge, code }), post(b, '/api/auth/mfa/verify', { challenge: cb.challenge, code })]);
    expect(results.map(r => r.status()).sort()).toEqual([200, 401]);
  });

  test('回復コードでログインしても「このブラウザを信頼する」は効かない', async () => {
    const acct = await accountWithMfa();
    const c = await client();
    const step = await (await login(c, acct.email)).json();
    await post(c, '/api/auth/mfa/verify', { challenge: step.challenge, code: acct.recovery[2], trust_device: true });
    expect(await db.known_devices.count({ where: { user_id: acct.id, mfa_trusted_until: { not: null } } })).toBe(0);
  });
});

test.describe('このブラウザを信頼する', () => {
  test('信頼したブラウザは、期間中はコードを省略できる。別のブラウザには効かない', async () => {
    const acct = await accountWithMfa();
    const mine = await client();
    const step = await (await login(mine, acct.email)).json();
    expect(step.trust_days).toBe(30);
    expect((await post(mine, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(acct.secret, acct.id), trust_device: true })).status()).toBe(200);
    const device = await db.known_devices.findFirst({ where: { user_id: acct.id, mfa_trusted_until: { not: null } } });
    expect(device!.mfa_trusted_until!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);

    const again = await (await login(mine, acct.email)).json();
    expect(again.ok).toBe(true); // straight in
    expect(await signedIn(mine)).toBe(true);

    const other = await client();
    expect((await (await login(other, acct.email)).json()).mfa_required).toBe(true);
  });

  test('「他の端末をログアウト」すると、信頼したブラウザも信頼されなくなる', async () => {
    const acct = await accountWithMfa();
    const mine = await client();
    const step = await (await login(mine, acct.email)).json();
    await post(mine, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(acct.secret, acct.id), trust_device: true });
    expect((await mine.delete('/api/security/sessions')).status()).toBe(200);
    expect((await (await login(mine, acct.email)).json()).mfa_required).toBe(true);
  });

  test('信頼は、期限が切れると効かない。設定で0日にすると使えない', async () => {
    const acct = await accountWithMfa();
    const c = await client();
    const step = await (await login(c, acct.email)).json();
    await post(c, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(acct.secret, acct.id), trust_device: true });
    await db.known_devices.updateMany({ where: { user_id: acct.id }, data: { mfa_trusted_until: new Date(Date.now() - 1000) } });
    expect((await (await login(c, acct.email)).json()).mfa_required).toBe(true);

    expect((await setRule(true, 0)).status()).toBe(200);
    await db.known_devices.updateMany({ where: { user_id: acct.id }, data: { mfa_trusted_until: null } });
    const d = await client();
    const s2 = await (await login(d, acct.email)).json();
    await post(d, '/api/auth/mfa/verify', { challenge: s2.challenge, code: await codeNow(acct.secret, acct.id), trust_device: true });
    expect(await db.known_devices.count({ where: { user_id: acct.id, mfa_trusted_until: { not: null } } })).toBe(0);
  });

  test('パスワード変更・管理者によるリセットで、信頼は取り消される', async ({ as }) => {
    const acct = await accountWithMfa();
    const c = await client();
    const step = await (await login(c, acct.email)).json();
    await post(c, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(acct.secret, acct.id), trust_device: true });
    expect(await db.known_devices.count({ where: { user_id: acct.id, mfa_trusted_until: { not: null } } })).toBe(1);
    await (await as('admin')).post(`/api/admin/security/users/${acct.id}/mfa-reset`);
    expect(await db.known_devices.count({ where: { user_id: acct.id, mfa_trusted_until: { not: null } } })).toBe(0);
  });
});

test.describe('プロフィールからの管理', () => {
  async function signedInWithMfa() {
    const acct = await accountWithMfa();
    const c = await client();
    const step = await (await login(c, acct.email)).json();
    await post(c, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(acct.secret, acct.id) });
    return { ...acct, c };
  }

  test('状態が分かる（有効・回復コードの残り・パスキー数・必須かどうか）', async () => {
    const a = await signedInWithMfa();
    expect(await (await a.c.get('/api/security/mfa')).json()).toMatchObject({ enabled: true, recovery_remaining: 10, passkeys: 0, required: true, trust_days: 30 });
  });

  test('ログインしていない人は操作できない', async () => {
    const c = await client();
    for (const url of ['/api/security/mfa', '/api/security/mfa/setup', '/api/security/mfa/disable', '/api/security/mfa/recovery-codes']) {
      expect([307, 401], url).toContain((await c.post(url, { data: {}, maxRedirects: 0 })).status());
    }
  });

  test('回復コードの再発行: パスワードと現在のコードが必要。新しい10個ができ、古いコードは使えなくなる', async () => {
    const a = await signedInWithMfa();
    expect((await post(a.c, '/api/security/mfa/recovery-codes', { password: 'wrong-password-1', code: await codeNow(a.secret, a.id) })).status()).toBe(400);
    expect((await post(a.c, '/api/security/mfa/recovery-codes', { password: PASSWORD, code: '000000' })).status()).toBe(400);
    const res = await post(a.c, '/api/security/mfa/recovery-codes', { password: PASSWORD, code: await codeNow(a.secret, a.id) });
    expect(res.status()).toBe(200);
    const fresh = (await res.json()).recovery_codes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh.some(c => a.recovery.includes(c))).toBe(false);
    const other = await client();
    const step = await (await login(other, a.email)).json();
    expect((await post(other, '/api/auth/mfa/verify', { challenge: step.challenge, code: a.recovery[3] })).status()).toBe(401); // an old code
    expect((await post(other, '/api/auth/mfa/verify', { challenge: step.challenge, code: fresh[0] })).status()).toBe(200);
  });

  test('解除: パスワードと現在のコードが必要。解除すると他の端末がログアウトされ、次のパスワードログインでは設定を求められる', async () => {
    const a = await signedInWithMfa();
    const elsewhere = await client();
    const st = await (await login(elsewhere, a.email)).json();
    await post(elsewhere, '/api/auth/mfa/verify', { challenge: st.challenge, code: await codeNow(a.secret, a.id) });
    expect(await signedIn(elsewhere)).toBe(true);

    expect((await post(a.c, '/api/security/mfa/disable', { password: PASSWORD, code: '111111' })).status()).toBe(400);
    expect((await db.users.findUnique({ where: { id: a.id } }))!.totp_enabled_at).not.toBeNull();
    expect((await post(a.c, '/api/security/mfa/disable', { password: PASSWORD, code: await codeNow(a.secret, a.id) })).status()).toBe(200);
    expect(await signedIn(elsewhere)).toBe(false);
    expect(await signedIn(a.c)).toBe(true);
    expect(await db.recovery_codes.count({ where: { user_id: a.id } })).toBe(0);
    expect((await (await login(await client(), a.email)).json()).mfa_setup_required).toBe(true);
    const posts = await mm.waitFor(p => p.message.includes('2段階認証が無効になりました'));
    expect(posts.map(p => p.to)).toEqual([a.mm]);
  });

  test('盗まれたセッションでは、パスワードを知らなければ解除も変更もできない。試行は5回まで', async () => {
    const a = await signedInWithMfa();
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await post(a.c, '/api/security/mfa/disable', { password: `guess-${i}-password`, code: '000000' })).status();
    expect(last).toBe(429);
    expect((await db.users.findUnique({ where: { id: a.id } }))!.totp_enabled_at).not.toBeNull();
  });

  test('認証アプリの変更: パスワードと現在のコードで本人確認をしてから、新しい鍵に切り替わる。古い鍵のコードは使えない', async () => {
    const a = await signedInWithMfa();
    expect((await post(a.c, '/api/security/mfa/setup', { password: PASSWORD })).status()).toBe(400); // an existing factor must be confirmed first
    const setup = await (await post(a.c, '/api/security/mfa/setup', { password: PASSWORD, code: await codeNow(a.secret, a.id) })).json();
    expect(setup.secret).not.toBe(a.secret);
    expect((await post(a.c, '/api/security/mfa/enable', { setup_token: setup.setup_token, code: '000000' })).status()).toBe(400);
    expect((await post(a.c, '/api/security/mfa/enable', { setup_token: setup.setup_token, code: await codeNow(setup.secret, a.id) })).status()).toBe(200);
    const other = await client();
    const step = await (await login(other, a.email)).json();
    expect((await post(other, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(a.secret, a.id) })).status()).toBe(401);
    expect((await post(other, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(setup.secret, a.id) })).status()).toBe(200);
  });

  test('ログイン用の設定トークンは、プロフィールの設定には使えない（逆も）', async () => {
    const a = await signedInWithMfa();
    const other = await newAccount();
    const c = await client();
    const { challenge } = await (await login(c, other.email)).json();
    const loginSetup = await (await post(c, '/api/auth/mfa/setup', { challenge })).json();
    expect((await post(a.c, '/api/security/mfa/enable', { setup_token: loginSetup.setup_token, code: await codeNow(loginSetup.secret, other.id) })).status()).toBe(401);
    const profileSetup = await (await post(a.c, '/api/security/mfa/setup', { password: PASSWORD, code: await codeNow(a.secret, a.id) })).json();
    expect((await post(c, '/api/auth/mfa/enable', { setup_token: profileSetup.setup_token, code: await codeNow(profileSetup.secret, a.id) })).status()).toBe(401);
  });
});

test.describe('管理者', () => {
  test('リセットすると、2段階認証と回復コードが消え、全端末がログアウトされ、本人に通知される。次のログインで設定し直す', async ({ as }) => {
    const acct = await accountWithMfa();
    const c = await client();
    const step = await (await login(c, acct.email)).json();
    await post(c, '/api/auth/mfa/verify', { challenge: step.challenge, code: await codeNow(acct.secret, acct.id) });
    expect(await signedIn(c)).toBe(true);
    const res = await (await as('admin')).post(`/api/admin/security/users/${acct.id}/mfa-reset`);
    expect((await res.json()).ended).toBeGreaterThan(0);
    expect(await signedIn(c)).toBe(false);
    expect(await db.users.findUnique({ where: { id: acct.id } })).toMatchObject({ totp_enabled_at: null, totp_secret_enc: null });
    expect(await db.recovery_codes.count({ where: { user_id: acct.id } })).toBe(0);
    expect((await (await login(await client(), acct.email)).json()).mfa_setup_required).toBe(true);
    const posts = await mm.waitFor(p => p.message.includes('リセットしました'));
    expect(posts.map(p => p.to)).toEqual([acct.mm]);
    expect((await db.audit_logs.count({ where: { action_type: 'mfa_reset', target_id: acct.id } }))).toBe(1);
  });

  test('リセットは管理者だけ。存在しないユーザーは404', async ({ as }) => {
    const acct = await accountWithMfa();
    for (const r of ['sato', 'keiri'] as const) expect((await (await as(r)).post(`/api/admin/security/users/${acct.id}/mfa-reset`)).status(), r).toBe(403);
    expect((await adminApi.post('/api/admin/security/users/nobody/mfa-reset')).status()).toBe(404);
    expect((await db.users.findUnique({ where: { id: acct.id } }))!.totp_enabled_at).not.toBeNull();
  });

  test('概要に、誰が2段階認証・パスキーを持っているかが出る（秘密は出ない）', async () => {
    const acct = await accountWithMfa();
    const o = await (await adminApi.get('/api/admin/security/overview')).json();
    expect(o.people.find((p: { id: string }) => p.id === acct.id)).toMatchObject({ mfa: true, passkeys: 0 });
    const text = JSON.stringify(o);
    expect(text).not.toContain(acct.secret);
    expect(text).not.toContain('totp_secret');
  });
});

test.describe('画面', () => {
  test('ログイン画面: 設定 → 回復コードの保存 → ログイン完了。ログアウトして再ログインするとコードを聞かれる', async ({ browser }) => {
    const acct = await newAccount();
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.fill('#email', acct.email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');

    await expect(page.getByRole('heading', { name: '2段階認証の設定' })).toBeVisible();
    await expect(page.getByText('パスワードでログインするには、2段階認証（認証アプリ）の設定が必要です')).toBeVisible();
    await expect(page.getByAltText('2段階認証の設定用QRコード')).toBeVisible();
    await page.getByText('QRコードを読み取れないとき').click();
    const secret = ((await page.getByLabel('設定キー').textContent()) ?? '').replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    await page.getByLabel('アプリに表示された6桁のコード').fill('000000');
    await page.getByRole('button', { name: '有効にする' }).click();
    await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toContainText('コードが正しくありません');
    await page.getByLabel('アプリに表示された6桁のコード').fill(await codeNow(secret, acct.id));
    await page.getByRole('button', { name: '有効にする' }).click();

    await expect(page.getByRole('heading', { name: '回復コード' })).toBeVisible();
    await expect(page.getByLabel('回復コード').getByRole('listitem')).toHaveCount(10);
    const next = page.getByRole('button', { name: 'ログインを続ける' });
    await expect(next).toBeDisabled(); // must say the codes were saved
    await page.getByLabel('回復コードを安全な場所に保存しました').check();
    await next.click();
    await expect(page).toHaveURL(/\/threads/);

    // log out and in again: now the code is asked for
    await page.locator('header').getByRole('button', { name: 'アカウントメニュー' }).click();
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.fill('#email', acct.email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await expect(page.getByRole('heading', { name: '2段階認証' })).toBeVisible();
    await page.getByLabel('認証コード').fill('111111');
    await page.getByRole('button', { name: '確認する' }).click();
    await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toContainText('コードが正しくありません');
    await page.getByLabel('認証コード').fill(await codeNow(secret, acct.id));
    await page.getByLabel(/このブラウザを30日間信頼する/).check();
    await page.getByRole('button', { name: '確認する' }).click();
    await expect(page).toHaveURL(/\/threads/);
    await ctx.close();
  });

  test('ログイン画面: 回復コードに切り替えて入れる。「最初に戻る」で取り消せる', async ({ browser }) => {
    const acct = await accountWithMfa();
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.fill('#email', acct.email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.getByRole('button', { name: '最初に戻る' }).click();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toHaveValue('');
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.getByRole('button', { name: '回復コードを使う' }).click();
    await expect(page.getByLabel(/このブラウザを.*信頼/)).toHaveCount(0); // not offered with a recovery code
    await page.getByLabel('回復コード').fill(acct.recovery[0]);
    await page.getByRole('button', { name: '確認する' }).click();
    await expect(page).toHaveURL(/\/threads/);
    await ctx.close();
  });

  test('プロフィール: 設定済みの状態が分かり、回復コードを再発行できる', async ({ browser }) => {
    const acct = await accountWithMfa();
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.fill('#email', acct.email); await page.fill('#password', PASSWORD); await page.click('button[type=submit]');
    await page.getByLabel('認証コード').fill(await codeNow(acct.secret, acct.id));
    await page.getByRole('button', { name: '確認する' }).click();
    await expect(page).toHaveURL(/\/threads/);
    await page.goto('/profile');
    const section = page.getByLabel('2段階認証', { exact: true });
    await expect(section.getByText('有効', { exact: true })).toBeVisible();
    await expect(section.getByText('回復コードの残り 10 個')).toBeVisible();
    await section.getByRole('button', { name: '回復コードを再発行' }).click();
    await section.getByLabel('パスワード').fill(PASSWORD);
    await section.getByLabel(/現在の認証コード/).fill(await codeNow(acct.secret, acct.id));
    await section.getByRole('button', { name: '次へ' }).click();
    await expect(section.getByLabel('回復コード').getByRole('listitem')).toHaveCount(10);
    await ctx.close();
  });

  test.describe('管理者', () => {
    test.use({ storageState: AUTH.admin });
    test('セキュリティ画面にログイン方法の一覧と、必須設定・リセットがある', async ({ page }) => {
      const acct = await accountWithMfa();
      const name = `一覧確認${acct.id.slice(-6)}`; // the other test accounts are all called 試験用
      await db.users.update({ where: { id: acct.id }, data: { name } });
      await page.goto('/admin/security#accounts');
      const list = page.getByLabel('ログイン方法', { exact: true });
      await expect(list.getByText('2段階認証 有効').first()).toBeVisible();
      await expect(list.getByText('2段階認証 未設定').first()).toBeVisible();
      page.once('dialog', d => d.accept());
      await list.getByRole('button', { name: `${name}の2段階認証をリセット` }).click();
      await expect.poll(async () => (await db.users.findUnique({ where: { id: acct.id } }))!.totp_enabled_at, { timeout: 15000 }).toBeNull();
      await page.getByRole('tab', { name: 'アクセスの条件' }).click();
      await expect(page.getByLabel('アクセスの条件', { exact: true }).getByLabel(/パスキー」または「パスワード＋2段階認証」だけにする/)).toBeChecked();
    });
  });
});

