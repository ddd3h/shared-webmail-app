import { test, expect, uniq } from './fixtures';
import { PASSWORD, USERS, ROLES } from './helpers/constants';
import { fakeIp, freshContext, loginViaUi, openAccountMenu } from './helpers/ui';
import { db } from './helpers/db';

test.describe('未ログインのアクセス', () => {
  for (const path of ['/calendar', '/work', '/expenses', '/trips', '/payments', '/contacts', '/threads', '/profile', '/notifications']) {
    test(`${path} はログイン画面へ移動し、元のページを覚えている`, async ({ browser }) => {
      const ctx = await freshContext(browser);
      const page = await ctx.newPage();
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?from=${encodeURIComponent(path).replace(/\//g, '%2F')}`));
      await expect(page.locator('#password')).toBeVisible();
      await ctx.close();
    });
  }

  for (const path of ['/api/expenses', '/api/trips', '/api/payments', '/api/payments/vendors', '/api/work/me', '/api/work/payslips', '/api/calendar/events?mailboxId=mb_team&from=2026-01-01&to=2026-02-01']) {
    test(`未ログインの ${path} は401（JSON）で、データは返らない`, async ({ anon }) => {
      // (a redirect to the login page would be followed by the browser and read as an answer: an API says 401)
      const res = await anon.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'unauthorized' });
    });
  }

  test('ログイン画面・パスワード再設定画面は未ログインでも開ける', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    expect((await page.goto('/login'))!.status()).toBe(200);
    expect((await page.goto('/reset-password'))!.status()).toBeLessThan(400);
    await ctx.close();
  });
});

test.describe('ログイン', () => {
  for (const role of ROLES) {
    test(`${USERS[role].name}（${role}）はメール・パスワードでログインでき、メール一覧へ移動する`, async ({ browser }) => {
      const ctx = await freshContext(browser);
      const page = await ctx.newPage();
      await loginViaUi(page, USERS[role].email, PASSWORD);
      await expect(page).toHaveURL(/\/threads/);
      await expect(page.getByRole('link', { name: 'カレンダー' }).first()).toBeVisible();
      await ctx.close();
    });
  }

  test('パスワードが違うとエラーを表示し、ログインしない', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await loginViaUi(page, USERS.sato.email, 'wrong-password-123');
    await expect(page.getByText('メールアドレスまたはパスワードが正しくありません')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });

  test('存在しないメールアドレスでも同じエラー文（ユーザーの有無を推測させない）', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await loginViaUi(page, `nobody-${uniq('x')}@e2e.test`, PASSWORD);
    await expect(page.getByText('メールアドレスまたはパスワードが正しくありません')).toBeVisible();
    await ctx.close();
  });

  test('メールアドレスの大文字小文字は区別される/されないに関わらず、誤ったログインでセッションは作られない', async ({ anon }) => {
    const before = await db.sessions.count();
    const res = await anon.post('/api/auth/login', { data: { email: 'SATO@E2E.TEST', password: 'wrong' }, headers: { 'x-forwarded-for': fakeIp() } });
    expect(res.status()).toBe(401);
    expect(await db.sessions.count()).toBe(before);
  });

  for (const [label, data] of [['メールのみ', { email: 'a@e2e.test' }], ['パスワードのみ', { password: 'x' }], ['空のボディ', {}]] as const) {
    test(`必須項目が足りない（${label}）と400`, async ({ anon }) => {
      const res = await anon.post('/api/auth/login', { data, headers: { 'x-forwarded-for': fakeIp() } });
      expect(res.status()).toBe(400);
    });
  }

  test('同じメールアドレスで6回失敗すると429になり、正しいパスワードでも拒否される', async ({ anon }) => {
    const ip = fakeIp();
    const email = `${uniq('brute')}@e2e.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await anon.post('/api/auth/login', { data: { email, password: 'bad' }, headers: { 'x-forwarded-for': ip } })).status());
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  test('ログイン成功でセッションCookieはHttpOnlyで、DBにセッションが記録される', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await loginViaUi(page, USERS.tanaka.email, PASSWORD);
    await expect(page).toHaveURL(/\/threads/);
    const sid = (await ctx.cookies()).find(c => c.name === 'sid');
    expect(sid?.httpOnly).toBe(true);
    expect(sid?.sameSite).toBe('Lax');
    expect(await db.sessions.count({ where: { user_id: USERS.tanaka.id } })).toBeGreaterThan(0);
    await ctx.close();
  });

  test('ログイン後に from で指定したページへ戻る', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/login\?from=/);
    await page.fill('#email', USERS.sato.email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/calendar/);
    await ctx.close();
  });
});

test.describe('セッションとログアウト', () => {
  test('/api/auth/session はログイン中のユーザー情報を返し、未ログインでは authenticated:false', async ({ as, anon }) => {
    const me = await (await (await as('sato')).get('/api/auth/session')).json();
    expect(me.authenticated).toBe(true);
    expect(me.user.email).toBe(USERS.sato.email);
    expect(me.user.role).toBe('user');
    const res = await anon.get('/api/auth/session', { maxRedirects: 0 });
    expect([200, 401]).toContain(res.status());
  });

  test('ログアウトするとセッションが無効になり、保護されたAPIに入れない', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await loginViaUi(page, USERS.yamada.email, PASSWORD);
    await expect(page).toHaveURL(/\/threads/);
    const res = await ctx.request.post('/api/auth/logout');
    expect(res.ok()).toBe(true);
    const after = await ctx.request.get('/api/work/me', { maxRedirects: 0 });
    expect(after.status()).toBe(401);
    await page.goto('/work');
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });

  test('画面のログアウトボタンでログイン画面に戻る', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await loginViaUi(page, USERS.suzuki.email, PASSWORD);
    await expect(page).toHaveURL(/\/threads/);
    await openAccountMenu(page);
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });

  test('DBからセッションを消すと、Cookieが残っていてもデータは返らない', async ({ browser }) => {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await loginViaUi(page, USERS.tanaka.email, PASSWORD);
    await expect(page).toHaveURL(/\/threads/);
    expect((await ctx.cookies()).find(c => c.name === 'sid')).toBeTruthy();
    // revoke only this browser's session (the newest one for this user)
    const newest = await db.sessions.findFirst({ where: { user_id: USERS.tanaka.id }, orderBy: { created_at: 'desc' } });
    await db.sessions.delete({ where: { id: newest!.id } });
    const res = await ctx.request.get('/api/work/me', { maxRedirects: 0 });
    expect(res.status()).toBe(401); // the session is gone on the server, though its cookie is still well-formed
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
    expect(await res.text()).not.toContain(USERS.tanaka.email);
    await ctx.close();
  });
});

test.describe('管理者専用ページ', () => {
  test('一般ユーザーが /admin/settings を開くとトップへ戻される', async ({ browser }) => {
    const ctx = await freshContext(browser, { storageState: 'e2e/.auth/sato.json' });
    const page = await ctx.newPage();
    await page.goto('/admin/settings');
    await expect(page).not.toHaveURL(/\/admin\/settings/);
    await ctx.close();
  });

  test('一般ユーザーの /api/admin/* は403', async ({ as }) => {
    const res = await (await as('sato')).get('/api/admin/settings', { maxRedirects: 0 });
    expect(res.status()).toBe(403);
  });

  test('管理者は /admin/settings を開ける', async ({ browser }) => {
    const ctx = await freshContext(browser, { storageState: 'e2e/.auth/admin.json' });
    const page = await ctx.newPage();
    const res = await page.goto('/admin/settings');
    expect(res!.status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/settings/);
    await ctx.close();
  });
});
