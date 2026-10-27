import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';

test.describe.configure({ mode: 'serial' });

const ago = (min: number) => new Date(Date.now() - min * 60_000);
async function seedLogs() {
  await db.login_logs.deleteMany({});
  const rows = [];
  // 60 successes of sato, 5 failures from 203.0.113.5 against sato, 3 failures from 203.0.113.9 against admin, one old failure
  for (let i = 0; i < 60; i++) rows.push({ user_id: USERS.sato.id, email: USERS.sato.email, ip_address: '10.0.0.1', success: true, created_at: ago(10 + i) });
  for (let i = 0; i < 5; i++) rows.push({ user_id: USERS.sato.id, email: USERS.sato.email, ip_address: '203.0.113.5', success: false, failure_reason: 'wrong_password', created_at: ago(1 + i) });
  for (let i = 0; i < 3; i++) rows.push({ user_id: USERS.admin.id, email: USERS.admin.email, ip_address: '203.0.113.9', success: false, failure_reason: 'wrong_password', created_at: ago(20 + i) });
  rows.push({ user_id: null, email: 'old@e2e.test', ip_address: '203.0.113.77', success: false, failure_reason: 'user_not_found', created_at: new Date(Date.now() - 3 * 24 * 3600_000) });
  await db.login_logs.createMany({ data: rows });
}
test.beforeEach(seedLogs);
test.afterAll(async () => { await db.login_logs.deleteMany({}); });

test.describe('管理画面のAPI', () => {
  test('概要: 件数と「多い順」は集計で出る（24時間より前は数えない）', async ({ as }) => {
    const o = await (await (await as('admin')).get('/api/admin/security/overview?lite=1')).json();
    expect(o.summary).toMatchObject({ failed_24h: 8, succeeded_24h: 60 });
    expect(o.top_ips).toEqual([{ key: '203.0.113.5', count: 5 }, { key: '203.0.113.9', count: 3 }]);
    expect(o.top_accounts).toEqual([{ key: USERS.sato.email, count: 5 }, { key: USERS.admin.email, count: 3 }]);
    expect(o.people).toBeUndefined(); // lite: the accounts have their own request
    expect(o.recent_logins).toBeUndefined();
  });

  test('lite でない概要は、これまでの形（アカウントと最近のログイン付き）のまま', async ({ as }) => {
    const o = await (await (await as('admin')).get('/api/admin/security/overview')).json();
    expect(o.people).toHaveLength(Object.keys(USERS).length);
    expect(o.recent_logins).toHaveLength(30);
  });

  test('アカウント: ロック中とログイン方法（パスキー数は一括で数える）', async ({ as }) => {
    await db.passkey_credentials.deleteMany({});
    const r = await (await (await as('admin')).get('/api/admin/security/people')).json();
    expect(r.people).toHaveLength(Object.keys(USERS).length);
    expect(r.people.every((p: { passkeys: number }) => p.passkeys === 0)).toBe(true);
    expect(r.locked).toEqual([]);
  });

  test('ログイン履歴: 50件ずつ新しい順に読め、続きは next で取れる', async ({ as }) => {
    const admin = await as('admin');
    const first = await (await admin.get('/api/admin/login-logs?limit=50')).json();
    expect(first.items).toHaveLength(50);
    expect(first.items[0]).toMatchObject({ ip: '203.0.113.5', success: false, reason: 'wrong_password', name: USERS.sato.name });
    expect(first.next).toBeTruthy();
    const second = await (await admin.get(`/api/admin/login-logs?limit=50&before=${encodeURIComponent(first.next)}`)).json();
    expect(second.items).toHaveLength(19); // 69 rows in all
    expect(second.next).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(69);
  });

  test('ログイン履歴: 失敗だけ・検索（メール・IP）で絞れる', async ({ as }) => {
    const admin = await as('admin');
    const failed = await (await admin.get('/api/admin/login-logs?failed=1&limit=100')).json();
    expect(failed.items).toHaveLength(9);
    expect(failed.items.every((i: { success: boolean }) => !i.success)).toBe(true);
    const byIp = await (await admin.get('/api/admin/login-logs?q=203.0.113.9')).json();
    expect(byIp.items).toHaveLength(3);
    const byMail = await (await admin.get('/api/admin/login-logs?q=old@e2e')).json();
    expect(byMail.items.map((i: { email: string }) => i.email)).toEqual(['old@e2e.test']);
    expect((await admin.get('/api/admin/login-logs?before=nonsense')).status()).toBe(400);
  });

  test('システム管理者以外（経理担当・一般）はどれも見られない', async ({ as }) => {
    for (const role of ['keiri', 'sato', 'admin2'] as const) {
      if (role === 'admin2') continue; // another administrator is allowed
      const c = await as(role);
      for (const url of ['/api/admin/security/overview?lite=1', '/api/admin/security/people', '/api/admin/login-logs', '/api/admin/sessions']) {
        expect((await c.get(url)).status(), `${role} ${url}`).toBe(403);
      }
    }
  });
});

test.describe('管理画面の画面', () => {
  test.use({ storageState: AUTH.admin });

  test('上の「管理」のバーに6つの画面があり、選ぶたびに移る。メニューの「管理」は点灯したまま', async ({ page }) => {
    await page.goto('/admin/settings');
    const bar = page.getByRole('navigation', { name: '管理メニュー' });
    for (const [label, url] of [['ユーザー', /\/admin\/users/], ['メールアカウント', /\/admin\/mailboxes/], ['迷惑メール', /\/admin\/spam/], ['セキュリティ', /\/admin\/security/], ['運用ログ', /\/admin\/operations/], ['システム設定', /\/admin\/settings/]] as const) {
      await bar.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(bar.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    }
    // the 管理 entry of the account menu stays lit on every one of these screens
    await page.locator('header').getByRole('button', { name: 'アカウントメニュー' }).click();
    await expect(page.locator('header').getByRole('link', { name: /^管理/ })).toHaveAttribute('aria-current', 'page');
  });

  test('ユーザー画面は、ユーザーの一覧だけを読み込む（設定やメールアカウントは読まない）', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) asked.push(u.pathname); });
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'ユーザー管理' })).toBeVisible();
    await expect(page.getByText(USERS.sato.email).first()).toBeVisible();
    expect(asked).toContain('/api/users');
    expect(asked).not.toContain('/api/admin/settings');
    expect(asked).not.toContain('/api/mailboxes');
  });

  test('セキュリティの「ログイン履歴」: 検索でき、もっと見るで続きが出る', async ({ page }) => {
    await page.goto('/admin/security#history');
    const panel = page.getByLabel('ログイン履歴', { exact: true });
    await expect(panel.locator('tbody tr')).toHaveCount(50);
    await panel.getByRole('button', { name: 'もっと見る' }).click();
    await expect(panel.locator('tbody tr')).toHaveCount(69);
    await panel.getByLabel('履歴を検索').fill('203.0.113.9');
    await expect(panel.locator('tbody tr')).toHaveCount(3);
    await panel.getByLabel('履歴を検索').fill('');
    await panel.getByLabel('失敗だけ').check();
    await expect(panel.locator('tbody tr')).toHaveCount(9);
  });

  test('「アカウントと端末」から、ログイン中の端末を強制的に終了できる', async ({ page }) => {
    const victim = await db.sessions.create({ data: { id: 'sess-e2e-victim', user_id: USERS.guest.id, ip_address: '203.0.113.50', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36', network_type: 'residential', expires_at: new Date(Date.now() + 3600_000) } });
    await page.goto('/admin/security#accounts');
    const panel = page.getByLabel('ログイン中の端末', { exact: true });
    await expect(panel.getByText('203.0.113.50')).toBeVisible();
    page.once('dialog', d => d.accept());
    await panel.getByRole('button', { name: `${USERS.guest.name}のこの端末を遮断` }).click();
    await expect(panel.getByText('203.0.113.50')).toHaveCount(0);
    expect(await db.sessions.count({ where: { id: victim.id } })).toBe(0);
    expect(await db.audit_logs.count({ where: { action_type: 'session_revoked', target_id: victim.id } })).toBe(1);
  });
});
