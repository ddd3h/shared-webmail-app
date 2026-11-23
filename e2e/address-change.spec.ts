import { generateKeyPairSync, randomBytes } from 'crypto';
import { request as pwRequest, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { BASE_URL, PASSWORD } from './helpers/constants';
import { db } from './helpers/db';
import { deleteAccountsWithPrefix, newAccount as newAccountIn } from './helpers/accounts';
import { resetSecurity } from './helpers/seed';
import { fakeIp, freshContext, loginViaUi } from './helpers/ui';
import { refreshSavedLogins } from './helpers/auth';

// A session is held (not ended) when it is used from an address it was not proved from, until the person proves who they are again there.
// Lines that send each connection out through one of two addresses (the case that kept logging a person out) must keep working after one proof.
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetSecurity(); });
test.afterAll(async () => { await resetSecurity(); await deleteAccountsWithPrefix('addr'); await refreshSavedLogins(); }); // (resetSecurity ends the saved login of the guest)

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const opened: APIRequestContext[] = [];
test.afterEach(async () => { await Promise.all(opened.splice(0).map(c => c.dispose())); });

/** A client signed in from `ip` with a fresh account (the wrong-proof limits are per session, but keep every test on its own person). */
async function signedInAt(ip: string) {
  const acct = await newAccountIn('addr');
  const c = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  opened.push(c);
  expect((await c.post('/api/auth/login', { data: { email: acct.email, password: PASSWORD } })).status()).toBe(200);
  return { c, acct };
}
const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip }, maxRedirects: 0 });
const threadsFrom = async (c: APIRequestContext, ip: string) => (await c.get('/api/threads', from(ip))).status();
const confirmFrom = (c: APIRequestContext, ip: string, data: Record<string, unknown>) => c.post('/api/auth/confirm-address', { ...from(ip), data });
const confirmedIps = async (userId: string) => (await db.sessions.findFirst({ where: { user_id: userId }, select: { confirmed_ips: true } }))?.confirmed_ips;
const events = (type: string, userId: string) => db.security_events.findMany({ where: { type, user_id: userId } });

test.describe('IPアドレスが変わったら、本人確認してから続ける', () => {
  test('新しいアドレスからは、パスワードで確かめるまで何も返さない。確かめたあとは新旧どちらのアドレスからも使える', async () => {
    const [a, b] = [fakeIp(), fakeIp()];
    const { c, acct } = await signedInAt(a);
    expect(await threadsFrom(c, b)).toBe(403);
    expect(await (await c.get('/api/auth/confirm-address', from(b))).json()).toEqual({ needed: true, method: 'password', code: false });

    const wrong = await confirmFrom(c, b, { password: 'not-the-password' });
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).error).toBe('wrong_password');
    expect(await threadsFrom(c, b)).toBe(403);

    expect((await confirmFrom(c, b, { password: PASSWORD })).status()).toBe(200);
    expect(await threadsFrom(c, b)).toBe(200);
    expect(await threadsFrom(c, a)).toBe(200);
    expect(await confirmedIps(acct.id)).toEqual([b]);
    expect((await events('session_ip_confirmed', acct.id)).length).toBe(1);
    expect((await events('session_ip_confirm_failed', acct.id)).length).toBe(1);
  });

  test('2つのアドレスに交互につながる回線: 確認の送信が元のアドレスから届いても、断られたほうのアドレスが認められる', async () => {
    const [a, b] = [fakeIp(), fakeIp()];
    const { c, acct } = await signedInAt(a);
    expect((await c.get('/api/auth/session', from(b))).status()).toBe(403); // refused from b: this browser now carries b (sealed cookie)
    expect(await (await c.get('/api/auth/confirm-address', from(a))).json()).toMatchObject({ needed: true });
    expect((await confirmFrom(c, a, { password: PASSWORD })).status()).toBe(200);
    for (const ip of [b, a, b, a]) expect(await threadsFrom(c, ip)).toBe(200);
    expect(await confirmedIps(acct.id)).toEqual([b]);
  });

  test('本人確認を5回まちがえると、セッションは終わる（盗んだCookieで当てずっぽうは5回まで）', async () => {
    const [a, b] = [fakeIp(), fakeIp()];
    const { c, acct } = await signedInAt(a);
    for (let i = 0; i < 4; i++) expect((await confirmFrom(c, b, { password: `wrong-${i}` })).status()).toBe(400);
    expect((await confirmFrom(c, b, { password: 'wrong-5' })).status()).toBe(401);
    expect(await db.sessions.count({ where: { user_id: acct.id } })).toBe(0);
    expect(await threadsFrom(c, a)).not.toBe(200); // the owner is signed out too, and logs in again
    const ended = await events('session_ip_mismatch', acct.id);
    expect(ended.length).toBe(1);
    expect(JSON.parse(ended[0].detail!).reason).toBe('too_many_wrong_proofs');
  });

  test('認めるアドレスは、断られた本人のブラウザが持つ封印つきCookieからだけ。送信内容・URL・別のセッションの記録では認められない', async () => {
    const [a, x] = [fakeIp(), fakeIp()];
    const { c, acct } = await signedInAt(a);
    // the owner is at their own address (nothing to confirm): an address named in the body or the URL is not taken
    expect((await confirmFrom(c, a, { password: PASSWORD, addresses: [x], address: x })).status()).toBe(200);
    expect((await c.get(`/confirm-address?address=${x}&from=%2Fthreads`, from(a))).status()).toBe(200);
    expect(await threadsFrom(c, x)).toBe(403);

    // a record of refused addresses made for another session (the thief's own login) does not count for this one
    const thief = await signedInAt(fakeIp());
    expect((await thief.c.get('/api/threads', from(x))).status()).toBe(403);
    const carried = (await thief.c.storageState()).cookies.find(k => k.name === 'addr_pending');
    expect(carried).toBeTruthy();
    const sid = (await c.storageState()).cookies.find(k => k.name === 'sid')!.value;
    const planted = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME, extraHTTPHeaders: { cookie: `sid=${sid}; addr_pending=${carried!.value}` } });
    opened.push(planted);
    expect((await confirmFrom(planted, a, { password: PASSWORD })).status()).toBe(200);
    expect(await threadsFrom(c, x)).toBe(403);
    // a forged record is ignored as well
    const forged = await pwRequest.newContext({ baseURL: BASE_URL, userAgent: CHROME, extraHTTPHeaders: { cookie: `sid=${sid}; addr_pending=${Buffer.from(JSON.stringify({ ips: [x] })).toString('base64')}` } });
    opened.push(forged);
    expect((await confirmFrom(forged, a, { password: PASSWORD })).status()).toBe(200);
    expect(await threadsFrom(c, x)).toBe(403);
    expect(await confirmedIps(acct.id)).toEqual([]);
  });
});

/** A passkey for `userId` that the browser's virtual authenticator holds (the key pair is made here, the public half goes to the DB). */
async function givePasskey(page: Page, userId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x!, 'base64url'), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y!, 'base64url')]);
  const id = randomBytes(16);
  await db.passkey_credentials.create({ data: { user_id: userId, credential_id: id.toString('base64url'), public_key: cose, transports: JSON.stringify(['internal']) } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: id.toString('base64'), isResidentCredential: true, rpId: new URL(BASE_URL).hostname, privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), userHandle: Buffer.from(userId).toString('base64'), signCount: 0 } });
}

/** The login form (its first compile can be slow on a cold dev server, so wait for it longer than an action would). */
async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('#email').waitFor({ timeout: 45_000 });
  await loginViaUi(page, email, PASSWORD);
}

/** Every request of the browser goes out from the next address of `ips` in turn (a line with two exits). */
async function alternate(ctx: BrowserContext, ips: string[]) {
  let n = 0;
  await ctx.route('**/*', route => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ips[n++ % ips.length] } }));
}

test.describe('画面での本人確認', () => {
  test('開いたページの接続元が変わっていたら、本人確認の画面になり、パスワードで確かめると元のページへ戻る', async ({ browser }) => {
    const acct = await newAccountIn('addr');
    const [a, b] = [fakeIp(), fakeIp()];
    const ctx = await freshContext(browser, { extraHTTPHeaders: { 'x-forwarded-for': a } });
    const page = await ctx.newPage();
    await logIn(page, acct.email);
    await expect(page).not.toHaveURL(/\/login/);

    await ctx.setExtraHTTPHeaders({ 'x-forwarded-for': b });
    await page.goto('/threads');
    await expect(page).toHaveURL(/\/confirm-address\?from=%2Fthreads/);
    await page.getByPlaceholder('パスワード').fill(PASSWORD);
    await page.getByRole('button', { name: '確認する' }).click();
    await expect(page).toHaveURL(/\/threads$/);
    await page.reload();
    await expect(page).toHaveURL(/\/threads$/);
    expect(await confirmedIps(acct.id)).toEqual([b]);
    await ctx.close();
  });

  test('ログインした直後から接続元が2つのアドレスに交互に変わる回線でも、1回確かめればログイン画面に戻されない（報告された流れ）', async ({ browser }) => {
    const acct = await newAccountIn('addr');
    const [a, b] = [fakeIp(), fakeIp()];
    const ctx = await freshContext(browser, { extraHTTPHeaders: { 'x-forwarded-for': a } });
    const page = await ctx.newPage();
    const visited: string[] = [];
    page.on('framenavigated', f => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
    await page.goto('/login');
    await page.locator('#email').waitFor({ timeout: 45_000 }); // (the first compile of the login form can be slow on a cold dev server)
    await page.fill('#email', acct.email);
    await page.fill('#password', PASSWORD);
    await alternate(ctx, [b, a]); // from the login itself on, every request goes out through the next of the two
    const atLogin = visited.length;
    await page.click('button[type=submit]');

    await expect(page).not.toHaveURL(/\/login/);
    await page.getByPlaceholder('パスワード').fill(PASSWORD); // the confirmation page or the dialog, whichever the line led to
    await page.getByRole('button', { name: '確認する' }).click();
    await expect(page.getByPlaceholder('パスワード')).toHaveCount(0);
    for (let i = 0; i < 3; i++) {
      await page.goto('/threads');
      await expect(page).toHaveURL(/\/threads$/);
      expect(await page.evaluate(() => fetch('/api/auth/session').then(r => r.status))).toBe(200);
    }
    await expect(page.getByPlaceholder('パスワード')).toHaveCount(0);
    expect(visited.slice(atLogin).filter(p => p === '/login')).toEqual([]); // never sent back to the login screen after logging in
    expect((await events('session_ip_confirmed', acct.id)).length).toBe(1);
    await ctx.close();
  });

  test('パスキーの人: 画面を開いたまま接続元が変わっても、パスキーで1回確かめれば、その操作も続きもそのまま通る。あとは2つの接続元を交互に使っても聞かれない', async ({ browser }) => {
    const acct = await newAccountIn('addr');
    const [a, b] = [fakeIp(), fakeIp()];
    const ctx = await freshContext(browser, { extraHTTPHeaders: { 'x-forwarded-for': a } });
    const page = await ctx.newPage();
    await logIn(page, acct.email);
    await expect(page).not.toHaveURL(/\/login/);
    await givePasskey(page, acct.id); // (from now on this person proves it with the passkey, as at the login)
    await page.goto('/threads');
    await expect(page).toHaveURL(/\/threads$/);

    await ctx.setExtraHTTPHeaders({ 'x-forwarded-for': b }); // the line now goes out through b
    const status = page.evaluate(() => fetch('/api/auth/session').then(r => r.status)); // an action of the screen, refused from b
    await expect(page.getByRole('dialog', { name: '本人確認' })).toBeVisible();
    await expect(page.getByPlaceholder('パスワード')).toHaveCount(0); // a person with a passkey is not offered the password
    await page.getByRole('button', { name: 'パスキーで確認する' }).click();
    expect(await status).toBe(200); // the very same request went through after the proof
    await expect(page.getByRole('dialog', { name: '本人確認' })).toHaveCount(0);

    await alternate(ctx, [a, b]); // and from now on through a and b in turn: both work, nothing more is asked
    for (let i = 0; i < 4; i++) expect(await page.evaluate(() => fetch('/api/auth/session').then(r => r.status))).toBe(200);
    await page.reload();
    await expect(page).toHaveURL(/\/threads$/);
    await expect(page.getByRole('dialog', { name: '本人確認' })).toHaveCount(0);
    expect(await confirmedIps(acct.id)).toEqual([b]);
    const ok = await events('session_ip_confirmed', acct.id);
    expect(JSON.parse(ok[0].detail!).method).toBe('passkey');
    await ctx.close();
  });
});
