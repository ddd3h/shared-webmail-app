import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => {
  await db.users.update({ where: { id: USERS.sato.id }, data: { org_unit_id: null, position_id: null, mattermost_user_id: null } });
  await db.org_units.deleteMany({ where: { id: 'u_prof' } });
  await db.org_positions.deleteMany({ where: { id: 'p_prof' } });
});

test.describe('プロフィール: 個人情報と受取口座をここにまとめる', () => {
  test.use({ storageState: AUTH.sato });

  test('個人情報（名前・メール・区分・所属・役職・権限・Mattermost）が出る。変更は管理者に依頼', async ({ page }) => {
    await db.org_units.create({ data: { id: 'u_prof', name: '営業部' } });
    await db.org_positions.create({ data: { id: 'p_prof', name: '課長', level: 3, permissions: [] } });
    await db.users.update({ where: { id: USERS.sato.id }, data: { org_unit_id: 'u_prof', position_id: 'p_prof', mattermost_user_id: 'mm-sato-x' } });
    await page.goto('/profile');
    const card = page.getByRole('region', { name: '個人情報' });
    for (const [k, v] of [['名前', '佐藤'], ['メールアドレス', 'sato@e2e.test'], ['区分', '従業員'], ['所属', '営業部'], ['役職', '課長'], ['システムの権限', '一般'], ['Mattermost連携', '連携済み']]) {
      await expect(card.locator('dt', { hasText: k }).locator('xpath=following-sibling::dd')).toContainText(v);
    }
    await expect(card).toContainText('管理者に依頼してください');
  });

  test('所属・役職が未設定、Mattermost未連携のときは、そう表示する。管理者は「管理者」', async ({ page, as }) => {
    await db.users.update({ where: { id: USERS.sato.id }, data: { org_unit_id: null, position_id: null, mattermost_user_id: null } });
    await page.goto('/profile');
    const card = page.getByRole('region', { name: '個人情報' });
    await expect(card.locator('dt', { hasText: '所属' }).locator('xpath=following-sibling::dd')).toHaveText('未設定');
    await expect(card.locator('dt', { hasText: 'Mattermost連携' }).locator('xpath=following-sibling::dd')).toHaveText('未連携');
    const info = await (await (await as('admin')).get('/api/profile/info')).json();
    expect(info).toMatchObject({ name: '管理者', is_admin: true, worker_type: '従業員' });
  });

  test('画面は「個人情報と口座」「ログインとセキュリティ」「メール」の順にまとまり、個人情報の中に受取口座がある', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('region', { name: '個人情報' })).toBeVisible();
    const titles = await page.locator('h2').filter({ hasText: /^(個人情報と口座|ログインとセキュリティ|メール)$/ }).allTextContents();
    expect(titles).toEqual(['個人情報と口座', 'ログインとセキュリティ', 'メール']);
    const bank = page.getByRole('region', { name: '受取口座' });
    await expect(bank).toBeVisible();
    // the order: personal info, then the account, then the security cards
    const y = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!.y;
    expect(await y('個人情報')).toBeLessThan(await y('受取口座'));
    expect(await y('受取口座')).toBeLessThan((await page.getByRole('heading', { name: 'パスワード変更' }).boundingBox())!.y);
  });

  test('勤怠・給与には受取口座のタブはなく、給与明細に「プロフィール › 受取口座」へのリンクがある', async ({ page }) => {
    await page.goto('/work');
    await expect(page.getByRole('button', { name: '受取口座', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '給与明細', exact: true }).click();
    await page.getByRole('link', { name: 'プロフィール › 受取口座' }).click();
    await expect(page).toHaveURL(/\/profile#bank/);
    await expect(page.getByPlaceholder('みずほ銀行')).toBeVisible();
  });

  test('ログインしていないと個人情報のAPIは使えない', async ({ anon }) => {
    expect((await anon.get('/api/profile/info', { maxRedirects: 0 })).status()).not.toBe(200);
  });
});
