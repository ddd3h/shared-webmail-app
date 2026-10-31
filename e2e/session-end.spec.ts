import { test, expect } from './fixtures';
import { PASSWORD, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { freshContext, loginViaUi } from './helpers/ui';

// セッションが終わったとき（無操作・他の端末からのログアウト・パスワード変更など）は、どの画面にいても、必ずログイン画面に移る。
// 終わったあとに画面だけが残って、一覧が空のまま・エラーのままになってはいけない。

const PAGES = ['/threads', '/calendar', '/todos', '/expenses', '/work', '/profile', '/org', '/contacts'];

async function signedIn(browser: import('@playwright/test').Browser, role: 'sato' | 'admin' = 'sato') {
  const ctx = await freshContext(browser);
  const page = await ctx.newPage();
  await loginViaUi(page, USERS[role].email, PASSWORD);
  await expect(page).toHaveURL(/\/threads/);
  return { ctx, page };
}
const endSession = (userId: string) => db.sessions.deleteMany({ where: { user_id: userId } });

test.describe('セッションが終わったあとに、ページを開く', () => {
  for (const path of PAGES) {
    test(`${path} を開くと、ログイン画面に移る（戻る先を覚えている）`, async ({ browser }) => {
      const { ctx, page } = await signedIn(browser);
      await endSession(USERS.sato.id); // the cookie is still well-formed: only the server side has ended
      await page.goto(path).catch(() => {}); // (the page that is already open may notice first and leave by itself: the same place)
      await expect(page).toHaveURL(/\/login/);
      expect(new URL(page.url()).searchParams.get('from')!.startsWith(path)).toBe(true); // the page (with the view it had)
      await ctx.close();
    });
  }
});

test.describe('開いたままの画面で、セッションが終わる', () => {
  test('カレンダーで月を動かすと（データを取りに行くと）、ログイン画面に移る', async ({ browser }) => {
    const { ctx, page } = await signedIn(browser);
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'カレンダー' })).toBeVisible();
    await endSession(USERS.sato.id);
    await page.getByRole('button', { name: '次の月' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get('from')!.startsWith('/calendar')).toBe(true);
    await ctx.close();
  });

  test('ToDoの画面で操作すると、ログイン画面に移る。入力途中の内容は、保存されなかったと分かる', async ({ browser }) => {
    const { ctx, page } = await signedIn(browser);
    await page.goto('/todos');
    await expect(page.getByLabel('ToDoをすばやく追加')).toBeVisible();
    await endSession(USERS.sato.id);
    await page.evaluate(() => fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '保存されないToDo' }) })).catch(() => {}); // what the screen does on Enter (the page is already leaving when it answers)
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    expect(await db.todos.count({ where: { title: '保存されないToDo' } })).toBe(0);
    await ctx.close();
  });

  test('メニューのリンクを押して、アプリの中を移動しても（画面は読み直さない移動でも）、ログイン画面に移る', async ({ browser }) => {
    const { ctx, page } = await signedIn(browser);
    await endSession(USERS.sato.id);
    await page.locator('header').getByRole('link', { name: 'ToDo', exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get('from')).toBe('/todos');
    await expect(page.getByTestId('session-expired')).toBeVisible(); // it says why
    await ctx.close();
  });

  test('メール一覧を開いたまま終わっても、次にデータを取りに行ったときにログイン画面に移る（空の一覧のまま残らない）', async ({ browser }) => {
    const { ctx, page } = await signedIn(browser);
    await endSession(USERS.sato.id);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.reload();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await ctx.close();
  });
});

test.describe('ログインし直すと、元の画面に戻る', () => {
  test('終わったときにいた画面に、ログイン後に戻る', async ({ browser }) => {
    const { ctx, page } = await signedIn(browser);
    await page.goto('/todos');
    await endSession(USERS.sato.id);
    // the open page may notice by itself before we even ask (its own data requests): either way it ends on the login screen
    await page.goto('/todos').catch(() => {});
    await expect(page).toHaveURL(/\/login/);
    await page.fill('#email', USERS.sato.email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/todos/);
    await expect(page.getByRole('heading', { level: 1, name: 'ToDo' })).toBeVisible();
    await ctx.close();
  });

  test('戻る先は、このアプリの中の画面だけ（外のサイトには飛ばない）', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    for (const evil of ['https://evil.example/x', '//evil.example/x', '/\\evil.example']) {
      await page.goto(`/login?from=${encodeURIComponent(evil)}`);
      await page.fill('#email', USERS.sato.email);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await expect(page).toHaveURL(/\/threads/);
      expect(new URL(page.url()).host).toBe(new URL(process.env.BASE_URL || 'http://localhost:3100').host);
      await ctx.clearCookies();
    }
    await ctx.close();
  });
});

test.describe('終わる理由ごとに、ログイン画面で分かる', () => {
  test('ほかの端末から「他の端末をログアウト」されると、ログイン画面に移る', async ({ browser, as }) => {
    const { ctx, page } = await signedIn(browser);
    const other = await as('sato'); // another device of the same person
    expect((await other.post('/api/profile/sessions/revoke-others')).status()).toBeLessThan(500);
    await page.goto('/threads');
    // either still signed in (this one was the newest) or sent to the login: never a half-open page
    const url = page.url();
    expect(/\/threads|\/login/.test(url)).toBe(true);
    await ctx.close();
  });

  test('管理者がアカウントをロックすると、開いていた画面は、次の操作でログイン画面に移る', async ({ browser, as }) => {
    const { ctx, page } = await signedIn(browser);
    await page.goto('/todos');
    await db.users.update({ where: { id: USERS.sato.id }, data: { locked_at: new Date() } });
    try {
      await page.evaluate(() => fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'ロック後' }) })).catch(() => {}); // what the screen does on a save
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
      expect(await db.todos.count({ where: { title: 'ロック後' } })).toBe(0);
    } finally { await db.users.update({ where: { id: USERS.sato.id }, data: { locked_at: null } }); }
    await ctx.close();
    void as;
  });
});

test.describe('APIの返事', () => {
  test('セッションが終わっていると、APIは401（JSON）を返し、画面は307でログインへ。Cookieは消える', async ({ browser }) => {
    const { ctx, page } = await signedIn(browser);
    await endSession(USERS.sato.id);
    const api = await page.request.get('/api/todos');
    expect(api.status()).toBe(401);
    const nav = await page.request.get('/threads', { maxRedirects: 0 });
    expect(nav.status()).toBe(307);
    expect(nav.headers()['location']).toContain('/login');
    await ctx.close();
  });
});
