import { request as pwRequest } from '@playwright/test';
import { test, expect } from './fixtures';
import { BASE_URL, PASSWORD, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { fakeIp, freshContext, loginViaUi } from './helpers/ui';

// 影響の大きい操作（ユーザー・権限・セキュリティ設定・振込データ・給与など）は、ログインやパスワードの入力から、設定した分数以内でないと実行できない。
// 超えていると403（recent_login_required）。画面は、その場でパスワードを聞いて、同じ操作をそのまま実行する。
test.describe.configure({ mode: 'serial' });
const setMinutes = (m: number) => db.app_settings.upsert({ where: { key: 'SECURITY_REAUTH_MINUTES' }, create: { key: 'SECURITY_REAUTH_MINUTES', value: String(m) }, update: { value: String(m) } });
const settle = () => new Promise(r => setTimeout(r, 500)); // the server remembers the settings for a moment
test.afterAll(async () => { await setMinutes(0); await settle(); });

async function apiLogin(email = USERS.admin.email) {
  const c = await pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': fakeIp() } });
  expect((await c.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
  return c;
}
const policyBody = async (c: import('@playwright/test').APIRequestContext) => {
  const { your_ip: _ip, ...p } = await (await c.get('/api/admin/security/policy')).json();
  return p;
};

test.describe('パスワードの入れ直し（高リスクの操作）', () => {
  test('ログインしたばかりなら実行できる。時間がたつと403になり、パスワードを入れ直すと、また実行できる（API・画面）', async ({ browser }) => {
    test.setTimeout(240_000);
    await setMinutes(1);
    await settle();
    const api = await apiLogin();
    const other = await apiLogin(); // another session of the same person: it is judged by itself
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    await loginViaUi(page, USERS.admin.email, PASSWORD);
    await expect(page).toHaveURL(/\/threads/);

    // just logged in: allowed
    const body = await policyBody(api);
    expect((await api.put('/api/admin/security/policy', { data: body })).status()).toBe(200);

    await new Promise(r => setTimeout(r, 62_000)); // the proof is older than the minute that is asked for

    // the ones that are only reads still work; the high-risk one is refused with a way forward
    expect((await api.get('/api/admin/security/policy')).status()).toBe(200);
    const stale = await api.put('/api/admin/security/policy', { data: body });
    expect(stale.status()).toBe(403);
    expect(await stale.json()).toMatchObject({ error: 'recent_login_required' });
    expect((await other.put('/api/admin/security/policy', { data: body })).status()).toBe(403);

    // a wrong password proves nothing; the right one makes THIS session recent
    expect((await api.post('/api/auth/reauth', { data: { password: 'wrong-password' } })).status()).toBe(400);
    expect((await api.put('/api/admin/security/policy', { data: body })).status()).toBe(403);
    expect((await api.post('/api/auth/reauth', { data: { password: PASSWORD } })).status()).toBe(200);
    expect((await api.put('/api/admin/security/policy', { data: body })).status()).toBe(200);
    expect((await other.put('/api/admin/security/policy', { data: body })).status()).toBe(403); // the other session did not prove anything

    // the screen: it asks for the password in a dialog, and the same save goes through (nothing typed is lost)
    await page.goto('/admin/security#access');
    const box = page.getByText(/操作がないときに自動ログアウトするまでの分数/).locator('..').locator('input');
    await expect(box).not.toHaveValue(''); // the settings have arrived (typing before that would be overwritten by them)
    await box.fill('20');
    await page.getByLabel('アクセスの条件', { exact: true }).getByRole('button', { name: '保存' }).click();
    const dialog = page.getByRole('dialog', { name: 'パスワードの確認' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('パスワード').fill('wrong-password');
    await dialog.getByRole('button', { name: '確認する' }).click();
    await expect(dialog.getByRole('alert')).toContainText('パスワードが違います');
    await dialog.getByLabel('パスワード').fill(PASSWORD);
    await dialog.getByRole('button', { name: '確認する' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    expect((await (await api.get('/api/admin/security/policy')).json()).idle_minutes).toBe(20);
    expect(await db.audit_logs.count({ where: { action_type: 'reauth_success', actor_user_id: USERS.admin.id } })).toBeGreaterThanOrEqual(2);

    // "やめる" leaves things as they were
    await page.reload();
    await page.getByText(/操作がないときに自動ログアウトするまでの分数/).locator('..').locator('input').fill('30');
    await db.sessions.updateMany({ where: { user_id: USERS.admin.id }, data: { reauth_at: new Date(Date.now() - 3 * 3600_000) } });
    await ctx.close(); await api.dispose(); await other.dispose();
  });

  test('設定が0分のときは、聞かない（これまでどおり）', async ({ as }) => {
    await setMinutes(0);
    await settle();
    const admin = await as('admin');
    expect((await admin.put('/api/admin/security/policy', { data: await policyBody(admin) })).status()).toBe(200);
  });

  test('パスワードの入れ直しは、ログインしていないと使えない。間違いが続くと止まる', async ({ anon }) => {
    expect((await anon.post('/api/auth/reauth', { data: { password: 'x' }, maxRedirects: 0 })).status()).toBe(401);
    const api = await apiLogin(USERS.sato.email);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await api.post('/api/auth/reauth', { data: { password: 'nope' } })).status());
    expect(codes.slice(0, 5).every(c => c === 400)).toBe(true);
    expect(codes[6]).toBe(429);
    await api.dispose();
  });
});
