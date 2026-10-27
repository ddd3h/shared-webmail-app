import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { BASE_URL, PASSWORD, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { fakeIp, freshContext, loginViaUi } from './helpers/ui';

test.describe.configure({ mode: 'serial' });

const setIdle = (minutes: number) => db.app_settings.upsert({ where: { key: 'SECURITY_IDLE_MINUTES' }, create: { key: 'SECURITY_IDLE_MINUTES', value: String(minutes) }, update: { value: String(minutes) } });
const settle = () => new Promise(r => setTimeout(r, 400)); // the server remembers the settings for a moment
test.afterEach(async () => { await setIdle(0); await settle(); });

const opened: APIRequestContext[] = [];
test.afterEach(async () => { await Promise.all(opened.splice(0).map(c => c.dispose())); });

/** A signed-in client with an address of its own (a session only works from the address it began on). */
async function signedIn() {
  const c = await pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': fakeIp() } });
  opened.push(c);
  const res = await c.post('/api/auth/login', { data: { email: USERS.tanaka.email, password: PASSWORD } });
  expect(res.status()).toBe(200);
  return c;
}
const sessionRow = async (c: APIRequestContext) => {
  const sid = (await c.storageState()).cookies.find(k => k.name === 'sid')!.value;
  void sid;
  const rows = await db.sessions.findMany({ where: { user_id: USERS.tanaka.id }, orderBy: { created_at: 'desc' }, take: 1 });
  return rows[0];
};
const alive = async (c: APIRequestContext) => {
  const res = await c.get('/api/auth/session', { maxRedirects: 0 });
  return res.status() === 200 && (await res.json()).authenticated === true;
};
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

test.describe('サーバー側: 操作がないログインは切れる', () => {
  test('設定の既定は10分で、管理者が変えられる。範囲外は400', async ({ as }) => {
    await db.app_settings.deleteMany({ where: { key: 'SECURITY_IDLE_MINUTES' } });
    await settle();
    const admin = await as('admin');
    const get = async () => (await (await admin.get('/api/admin/security/policy')).json()).idle_minutes;
    expect(await get()).toBe(10);
    const { your_ip, ...p } = await (await admin.get('/api/admin/security/policy')).json(); void your_ip;
    expect((await admin.put('/api/admin/security/policy', { data: { ...p, idle_minutes: 5 } })).ok()).toBeTruthy();
    expect(await get()).toBe(5);
    for (const bad of [-1, 1441, 2.5]) expect((await admin.put('/api/admin/security/policy', { data: { ...p, idle_minutes: bad } })).status(), String(bad)).toBe(400);
    expect(await get()).toBe(5);
    // a save that does not mention it keeps it
    const { idle_minutes, ...without } = p; void idle_minutes;
    expect((await admin.put('/api/admin/security/policy', { data: without })).ok()).toBeTruthy();
    expect(await get()).toBe(5);
  });

  test('10分より長く操作がなければ、次のリクエストでログアウトになりセッションも消える', async () => {
    await setIdle(10); await settle();
    const c = await signedIn();
    expect(await alive(c)).toBe(true);
    const row = await sessionRow(c);
    await db.sessions.update({ where: { id: row.id }, data: { last_input_at: minutesAgo(12) } });
    expect(await alive(c)).toBe(false);
    expect(await db.sessions.findUnique({ where: { id: row.id } })).toBeNull();
    expect((await c.get('/api/threads?type=personal', { maxRedirects: 0 })).status()).not.toBe(200);
  });

  test('9分前の操作ならまだ続く。切れたあとの「生きてます」では復活しない', async () => {
    await setIdle(10); await settle();
    const c = await signedIn();
    const row = await sessionRow(c);
    await db.sessions.update({ where: { id: row.id }, data: { last_input_at: minutesAgo(9) } });
    expect(await alive(c)).toBe(true);
    await db.sessions.update({ where: { id: row.id }, data: { last_input_at: minutesAgo(30) } });
    expect((await c.post('/api/auth/activity', { maxRedirects: 0 })).status()).toBe(401);
    expect(await db.sessions.findUnique({ where: { id: row.id } })).toBeNull();
  });

  test('「生きてます」を送ると時刻が進む。画面が勝手に行う通信（一覧の取得など）では進まない', async () => {
    await setIdle(10); await settle();
    const c = await signedIn();
    const row = await sessionRow(c);
    const old = minutesAgo(8);
    await db.sessions.update({ where: { id: row.id }, data: { last_input_at: old } });
    expect((await c.get('/api/threads?type=personal')).status()).toBe(200);
    expect((await db.sessions.findUnique({ where: { id: row.id } }))!.last_input_at.getTime()).toBe(old.getTime());
    const res = await c.post('/api/auth/activity');
    expect(res.status()).toBe(200);
    expect((await res.json()).idle_minutes).toBe(10);
    expect(Date.now() - (await db.sessions.findUnique({ where: { id: row.id } }))!.last_input_at.getTime()).toBeLessThan(5_000);
  });

  test('0（なし）なら何時間たってもログアウトしない。ログインしていなければ401', async ({ anon }) => {
    await setIdle(0); await settle();
    const c = await signedIn();
    await db.sessions.update({ where: { id: (await sessionRow(c)).id }, data: { last_input_at: minutesAgo(600) } });
    expect(await alive(c)).toBe(true);
    expect((await anon.post('/api/auth/activity', { maxRedirects: 0 })).status()).not.toBe(200);
  });
});

test.describe('画面: 予告と自動ログアウト', () => {
  test('操作がないと1分前に予告が出て、「続ける」で延びる。そのまま放置するとログイン画面へ', async ({ browser }) => {
    await setIdle(10); await settle();
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.clock.install();
    await loginViaUi(page, USERS.tanaka.email, PASSWORD);
    await expect(page).toHaveURL(/\/threads/);
    await page.clock.runFor('00:05'); // let the page learn the setting

    await page.clock.runFor('09:10');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByText(/あと \d+ 秒で自動的にログアウト/)).toBeVisible();
    await page.getByRole('button', { name: 'ログインを続ける' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // the warning is gone and the clock starts again
    await page.clock.runFor('08:00');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.clock.runFor('01:30');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.clock.runFor('01:10');
    await expect(page).toHaveURL(/\/login\?reason=idle/);
    await expect(page.getByText('しばらく操作がなかったため、自動的にログアウトしました')).toBeVisible();
    // the session is really over, not just hidden
    expect((await ctx.request.get('/api/auth/session', { maxRedirects: 0 }).then(r => r.json().catch(() => ({})))).authenticated).not.toBe(true);
    await ctx.close();
  });

  test('操作を続けていれば、予告も出ずログアウトもされない', async ({ browser }) => {
    await setIdle(10); await settle();
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.clock.install();
    await loginViaUi(page, USERS.tanaka.email, PASSWORD);
    await expect(page).toHaveURL(/\/threads/);
    await page.clock.runFor('00:05');
    for (let i = 0; i < 4; i++) {
      await page.clock.runFor('05:00');
      await page.mouse.move(100 + i * 10, 200);
      await page.keyboard.press('Shift');
    }
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/threads/);
    await ctx.close();
  });

  test('管理画面の「アクセスの条件」に分数の欄があり、保存できる', async ({ browser, as }) => {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const page = await ctx.newPage();
    try {
      await page.goto('/admin/security#access');
      const box = page.getByText(/操作がないときに自動ログアウトするまでの分数/).locator('..').locator('input');
      await box.fill('15');
      await page.getByLabel('アクセスの条件', { exact: true }).getByRole('button', { name: '保存' }).click();
      await expect(page.getByText('保存しました')).toBeVisible();
      expect((await (await (await as('admin')).get('/api/admin/security/policy')).json()).idle_minutes).toBe(15);
    } finally {
      await ctx.close();
    }
  });
});
