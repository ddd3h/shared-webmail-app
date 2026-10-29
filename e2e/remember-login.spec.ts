import { test, expect } from './fixtures';
import { request as pwRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, PASSWORD } from './helpers/constants';
import { db } from './helpers/db';
import { deleteAccountsWithPrefix, newAccount } from './helpers/accounts';

test.describe.configure({ mode: 'serial' });
// the accounts of this spec are called rem-…; they must not stay behind (other specs count the users)
test.afterAll(async () => { await db.known_devices.deleteMany({ where: { user_id: { startsWith: 'u_rem-' } } }); await deleteAccountsWithPrefix('rem'); });

const uaOf = (page: Page) => page.evaluate(() => navigator.userAgent); // the browser's own, whatever the test machine is
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

// the home-screen app: the page reports display-mode standalone
// every app gets an address of its own: the server allows 20 logins per address and quarter of an hour, and this spec logs in a lot
let nth = 0;
const nextIp = () => `10.77.${Math.floor(nth / 250)}.${(nth++ % 250) + 1}`;
async function installedApp(browser: Browser) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': nextIp() } });
  await ctx.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes('display-mode: standalone')
      ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList)
      : orig(q));
  });
  return ctx;
}

async function loginInApp(ctx: BrowserContext, acct: { email: string }) {
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('#email').fill(acct.email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).toHaveURL(/\/threads/);
  return page;
}

const device = (userId: string) => db.known_devices.findFirstOrThrow({ where: { user_id: userId }, orderBy: { first_seen_at: 'desc' } });
const sessionsOf = (userId: string) => db.sessions.findMany({ where: { user_id: userId } });

// what the app's own code does, run inside the page: sign a challenge with the stored (non-extractable) key
async function signInPage(page: Page, challenge: string) {
  return page.evaluate(async (c: string) => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('webmail-device', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec: { privateKey: CryptoKey; keyId: string } = await new Promise((res, rej) => { const r = db.transaction('keys').objectStore('keys').get('main'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, rec.privateKey, new TextEncoder().encode(`webmail-resume|v1|${rec.keyId}|${c}`)));
    return { signature: btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), keyId: rec.keyId, extractable: rec.privateKey.extractable };
  }, challenge);
}
async function didCookie(ctx: BrowserContext) { return (await ctx.cookies()).find(c => c.name === 'did')!.value; }
async function apiAs(ua: string, cookie: string): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'user-agent': ua, cookie: `did=${cookie}` } });
}
const challengeOf = async (api: APIRequestContext) => (await (await api.post('/api/auth/resume/challenge')).json()).challenge as string;

test.describe('アプリ（PWA）のログイン維持', () => {
  test('ホーム画面のアプリでログインすると、端末の鍵ができ、サーバーが個体番号を覚える。秘密鍵は取り出せない', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await ctx.newPage();
    await page.goto('/login');
    await expect(page.getByLabel(/このアプリでログインを維持する/)).toBeChecked();
    await page.locator('#email').fill(acct.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page).toHaveURL(/\/threads/);

    const d = await device(acct.id);
    expect(d.key_id).toMatch(/^[0-9a-f]{64}$/);
    expect(d.public_key).toBeTruthy();
    expect(d.device_fp).toMatch(/^Chrome\/(Windows|Linux|macOS)$/);
    const days = (d.remember_until!.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(29); expect(days).toBeLessThanOrEqual(30);
    expect(await page.evaluate(() => localStorage.getItem('pwa-remember'))).toBe('1');
    const c = await challengeOf(await apiAs(await uaOf(page), await didCookie(ctx)));
    const signed = await signInPage(page, c);
    expect(signed.keyId).toBe(d.key_id); // the number the device computed is the number the server holds
    expect(signed.extractable).toBe(false);
    await ctx.close();
  });

  test('セッションが切れても、アプリを開くとパスワードなしで入り直せる（ログイン画面は一瞬）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await db.sessions.deleteMany({ where: { user_id: acct.id } }); // idle time ran out
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/calendar/);
    // the page notices at once (the cookie is still there, the session behind it is gone), logs in again with its key and reloads
    await expect.poll(async () => (await sessionsOf(acct.id)).length, { timeout: 15_000 }).toBe(1);
    await expect(page.getByRole('heading', { name: 'カレンダー' })).toBeVisible();
    expect(await db.audit_logs.count({ where: { actor_user_id: acct.id, action_type: 'login_resume' } })).toBe(1);
    await ctx.close();
  });

  test('アプリは端末の鍵だけで判断する: 別のネットワークに移っても、セッションは終わらない（通常のブラウザと違い、アドレスは見ない）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    const before = (await sessionsOf(acct.id))[0].id;
    await db.sessions.updateMany({ where: { user_id: acct.id }, data: { ip_address: '203.0.113.99' } }); // as if it had begun on another network
    await page.goto('/threads');
    await expect(page.getByRole('link', { name: 'カレンダー' }).first()).toBeVisible();
    const rows = await sessionsOf(acct.id);
    expect(rows.map(r => r.id)).toEqual([before]); // the same session, not ended and not replaced
    expect(await db.security_events.count({ where: { type: 'session_ip_mismatch', user_id: acct.id } })).toBe(0);
    await ctx.close();
  });

  test('アプリは、設定した無操作の時間がたっても、ログアウトされない（サーバーも、画面も）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    const set = (m: number) => db.app_settings.upsert({ where: { key: 'SECURITY_IDLE_MINUTES' }, create: { key: 'SECURITY_IDLE_MINUTES', value: String(m) }, update: { value: String(m) } });
    try {
      await set(10);
      await new Promise(r => setTimeout(r, 500)); // the server remembers the settings for a moment
      await db.sessions.updateMany({ where: { user_id: acct.id }, data: { last_input_at: new Date(Date.now() - 120 * 60_000) } });
      const res = await page.request.get('/api/auth/session');
      expect(await res.json()).toMatchObject({ authenticated: true, idle_minutes: 0 }); // the page is told: no idle limit for this app
      await page.goto('/threads');
      await expect(page.getByRole('link', { name: 'カレンダー' }).first()).toBeVisible();
      expect(await sessionsOf(acct.id)).toHaveLength(1);
    } finally { await set(0); await new Promise(r => setTimeout(r, 500)); }
    await ctx.close();
  });

  test('アプリが別のネットワークから入り直しても通る（チャレンジをもらったアドレスと、答えるアドレスが違っても）。新しいセッションも、アドレスで縛られない', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    const asked = await apiAs(await uaOf(page), await didCookie(ctx));
    const challenge = await challengeOf(asked);
    const { signature } = await signInPage(page, challenge);
    const answered = await pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'user-agent': await uaOf(page), cookie: `did=${await didCookie(ctx)}`, 'x-forwarded-for': '198.51.100.77' } });
    expect((await answered.post('/api/auth/resume', { data: { challenge, signature } })).status()).toBe(200);
    expect(await db.security_events.count({ where: { type: 'device_login_refused', user_id: acct.id } })).toBe(0);
    await answered.dispose(); await asked.dispose(); await ctx.close();
  });

  test('開きっぱなしのアプリが前面に戻ったとき、セッション切れを自動で直して再読み込みする', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await db.sessions.deleteMany({ where: { user_id: acct.id } });
    // back in front after a while: the page checks at most every 30 seconds, so let it look as if a minute had passed
    await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 60_000; window.dispatchEvent(new Event('focus')); });
    await expect.poll(async () => (await sessionsOf(acct.id)).length, { timeout: 15_000 }).toBe(1);
    await expect(page).toHaveURL(/\/threads/);
    await ctx.close();
  });

  test('使わないまま設定の日数が過ぎると、パスワードが必要（自動では入れない）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await db.known_devices.updateMany({ where: { user_id: acct.id }, data: { remember_until: new Date(Date.now() - 60_000) } });
    await db.sessions.deleteMany({ where: { user_id: acct.id } });
    await page.goto('/threads');
    await expect(page.locator('#password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('pwa-remember'))).toBeNull(); // the app dropped its key too
    await ctx.close();
  });

  test('使うたびに期限が延びる（最後に使ってから日数）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await db.known_devices.updateMany({ where: { user_id: acct.id }, data: { remember_until: new Date(Date.now() + 2 * 86400_000) } });
    await db.sessions.deleteMany({ where: { user_id: acct.id } });
    await page.goto('/threads');
    await expect(page).toHaveURL(/\/threads/);
    await expect.poll(async () => ((await device(acct.id)).remember_until!.getTime() - Date.now()) / 86400_000, { timeout: 15_000 }).toBeGreaterThan(29);
    await ctx.close();
  });

  test('ログアウトすると維持は終わる。次はパスワードが必要', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
    expect((await device(acct.id)).remember_until).toBeNull();
    expect((await device(acct.id)).public_key).toBeNull();
    await page.goto('/threads');
    await expect(page.locator('#password')).toBeVisible();
    await ctx.close();
  });

  test('「他の端末をログアウト」で、すべての端末の維持が終わる（そのアプリも、次はパスワードが必要）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    expect((await device(acct.id)).remember_until).not.toBeNull();
    expect(await page.evaluate(async () => (await fetch('/api/security/sessions', { method: 'DELETE' })).status)).toBe(200);
    expect((await device(acct.id)).remember_until).toBeNull();
    expect((await device(acct.id)).public_key).toBeNull();
    await ctx.close();
  });

  test('通常のブラウザ（アプリではない）にはチェックが出ず、鍵も作らず、維持もされない', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': nextIp() } });
    const page = await ctx.newPage();
    await page.goto('/login');
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByLabel(/このアプリでログインを維持する/)).toHaveCount(0);
    await page.locator('#email').fill(acct.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page).toHaveURL(/\/threads/);
    expect((await device(acct.id)).remember_until).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('pwa-remember'))).toBeNull();
    await ctx.close();
  });
});

test.describe('盗まれたとき・なりすまし', () => {
  test('did クッキーだけを盗んでも、鍵がなければ入れない（署名が合わない）。記録に残る', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await db.security_events.deleteMany({ where: { type: 'device_login_refused' } });
    const thief = await apiAs(await uaOf(page), await didCookie(ctx));
    const res = await thief.post('/api/auth/resume', { data: { challenge: await challengeOf(thief), signature: Buffer.alloc(64, 7).toString('base64url') } });
    expect(res.status()).toBe(401);
    expect(res.headers()['set-cookie'] ?? '').not.toContain('sid=');
    const ev = await db.security_events.findFirstOrThrow({ where: { type: 'device_login_refused', user_id: acct.id } });
    expect(JSON.parse(ev.detail!)).toMatchObject({ reason: 'signature' });
    await ctx.close();
  });

  test('端末の鍵が正しければ、ブラウザの種類・バージョンが変わっても入れる（OSの更新で入れなくならない）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await db.security_events.deleteMany({ where: { type: 'device_login_refused' } });
    const other = await apiAs(SAFARI_MAC, await didCookie(ctx));
    const challenge = await challengeOf(other);
    const { signature } = await signInPage(page, challenge);
    expect((await other.post('/api/auth/resume', { data: { challenge, signature } })).status()).toBe(200);
    expect(await db.security_events.count({ where: { type: 'device_login_refused', user_id: acct.id } })).toBe(0);
    await ctx.close();
  });

  test('一度使ったチャレンジの使い回し（リプレイ）は通らない。他の人のチャレンジも通らない', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    const api = await apiAs(await uaOf(page), await didCookie(ctx));
    const challenge = await challengeOf(api);
    const { signature } = await signInPage(page, challenge);
    expect((await api.post('/api/auth/resume', { data: { challenge, signature } })).status()).toBe(200);
    expect((await api.post('/api/auth/resume', { data: { challenge, signature } })).status()).toBe(401);
    const c2 = await challengeOf(api);
    const sig2 = (await signInPage(page, c2)).signature;
    expect((await api.post('/api/auth/resume', { data: { challenge: await challengeOf(api), signature: sig2 } })).status()).toBe(401); // signed another note
    await ctx.close();
  });

  test('別の人のアカウントの鍵では入れない（鍵は端末ごと・アカウントごと）', async ({ browser }) => {
    const a = await newAccount('rem'), b = await newAccount('rem');
    const ctxA = await installedApp(browser), ctxB = await installedApp(browser);
    const pageA = await loginInApp(ctxA, a);
    await loginInApp(ctxB, b);
    const api = await apiAs(await uaOf(pageA), await didCookie(ctxB)); // B's browser cookie ...
    const challenge = await challengeOf(api);
    const { signature } = await signInPage(pageA, challenge);    // ... with A's key
    expect((await api.post('/api/auth/resume', { data: { challenge, signature } })).status()).toBe(401);
    await ctxA.close(); await ctxB.close();
  });

  test('鍵で入り直したセッションは、パスキー・受取口座など「入れる人」を変える操作はできない。読むのは普通にできる', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    await db.sessions.deleteMany({ where: { user_id: acct.id } });
    await page.goto('/threads'); // resumed by the key (the page notices and logs in again by itself)
    await expect.poll(async () => (await sessionsOf(acct.id)).length, { timeout: 15_000 }).toBe(1);
    await expect(page).toHaveURL(/\/threads/);
    const status = (method: string, url: string, data?: object) => page.evaluate(async ([m, u, d]: readonly [string, string, object | undefined]) => {
      const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: d ? JSON.stringify(d) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, [method, url, data] as const);
    expect((await status('GET', '/api/threads?type=personal')).status).toBe(200);
    expect(await status('PUT', '/api/bank-accounts/me', {})).toMatchObject({ status: 403, body: { error: 'reauth_required' } });
    expect(await status('POST', '/api/passkeys/register', {})).toMatchObject({ status: 403, body: { error: 'reauth_required' } });
    // the session cookie refreshed by later requests is still "resumed"
    expect(await status('PUT', '/api/bank-accounts/me', {})).toMatchObject({ status: 403 });
    await ctx.close();
  });

  test('パスワードで入った普通のセッションは、同じ操作の検査を通る（403の「再ログイン要求」ではない）', async ({ browser }) => {
    const acct = await newAccount('rem');
    const ctx = await installedApp(browser);
    const page = await loginInApp(ctx, acct);
    const r = await page.evaluate(async () => { const x = await fetch('/api/bank-accounts/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return { status: x.status, body: await x.json().catch(() => ({})) }; });
    expect(r.body.error).not.toBe('reauth_required');
    await ctx.close();
  });
});

test.describe('管理者の設定', () => {
  test('日数を0にすると維持されない。既にある端末も、入り直せなくなる', async ({ browser, as }) => {
    const acct = await newAccount('rem');
    const admin = await as('admin');
    const get = async () => (await (await admin.get('/api/admin/security/policy')).json());
    const original = await get();
    const put = async (remember_days: number) => {
      const { your_ip, ...rest } = await get(); void your_ip;
      expect((await admin.put('/api/admin/security/policy', { data: { ...rest, remember_days } })).ok()).toBeTruthy();
      await new Promise(r => setTimeout(r, 400));
    };
    try {
      expect(original.remember_days).toBe(30);
      const ctx = await installedApp(browser);
      const page = await loginInApp(ctx, acct);
      await put(0);
      await db.sessions.deleteMany({ where: { user_id: acct.id } });
      await page.goto('/threads');
      await expect(page.locator('#password')).toBeVisible();
      await ctx.close();
      const ctx2 = await installedApp(browser);
      await loginInApp(ctx2, acct);
      expect((await device(acct.id)).remember_until).toBeNull(); // the server did not keep this one
      await ctx2.close();
    } finally {
      await put(original.remember_days);
    }
  });
});
