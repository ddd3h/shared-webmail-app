import { test, expect } from './fixtures';
import { PASSWORD, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { freshContext, loginViaUi } from './helpers/ui';

// パスキーを登録している人は、影響の大きい操作の「本人確認」も、パスワードではなくパスキーでする（パスワードではログインできない人なので）。
// 本物のブラウザの「仮想の認証器」（WebAuthn）で、登録から確認まで通す。
test.describe.configure({ mode: 'serial' });
const setMinutes = (m: number) => db.app_settings.upsert({ where: { key: 'SECURITY_REAUTH_MINUTES' }, create: { key: 'SECURITY_REAUTH_MINUTES', value: String(m) }, update: { value: String(m) } });
const settle = () => new Promise(r => setTimeout(r, 500));
test.afterAll(async () => { await db.passkey_credentials.deleteMany({ where: { user_id: USERS.admin.id } }); await setMinutes(0); await settle(); });

test('パスキーのある管理者は、パスワードではなくパスキーで本人確認し、止められていた操作がそのまま実行される', async ({ browser }) => {
  test.setTimeout(240_000);
  await db.passkey_credentials.deleteMany({ where: { user_id: USERS.admin.id } });
  await setMinutes(1);
  await settle();
  const ctx = await freshContext(browser);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  await loginViaUi(page, USERS.admin.email, PASSWORD);
  await expect(page).toHaveURL(/\/threads/);
  await page.goto('/profile');
  await page.getByRole('button', { name: '追加' }).first().click();
  await page.getByRole('button', { name: 'パスキーを登録する' }).click();
  await expect.poll(() => db.passkey_credentials.count({ where: { user_id: USERS.admin.id } }), { timeout: 20_000 }).toBe(1);

  await new Promise(r => setTimeout(r, 62_000)); // the proof is older than the minute that is asked for

  await page.goto('/admin/security#access');
  const box = page.getByText(/操作がないときに自動ログアウトするまでの分数/).locator('..').locator('input');
  await expect(box).not.toHaveValue('');
  await box.fill('25');
  await page.getByLabel('アクセスの条件', { exact: true }).getByRole('button', { name: '保存' }).click();

  // the dialog asks for the passkey - not the password
  const dialog = page.getByRole('dialog', { name: 'パスキーで本人確認' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('パスワード')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'パスキーで確認する' }).click();
  await expect(page.getByText('保存しました')).toBeVisible();
  expect((await (await ctx.request.get('/api/admin/security/policy')).json()).idle_minutes).toBe(25);
  expect(await db.audit_logs.count({ where: { action_type: 'reauth_success', actor_user_id: USERS.admin.id } })).toBeGreaterThanOrEqual(1);

  // the password alone proves nothing for somebody with a passkey
  const refused = await ctx.request.post('/api/auth/reauth', { data: { password: PASSWORD } });
  expect(refused.status()).toBe(400);
  expect(await refused.json()).toMatchObject({ error: 'passkey_required' });
  await ctx.close();
});
