import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { db } from './helpers/db';
import { makePayslip } from './helpers/factories';
import { resetTransfers } from './helpers/seed';
import { hasHorizontalOverflow } from './helpers/ui';

test.beforeEach(async () => { await resetTransfers(); });

const ACCOUNT = { bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '234', account_type: 'ordinary', account_number: '1234567', account_holder: 'サトウ タロウ' };

test.describe('スマホ: 受取口座', () => {
  test.use({ storageState: AUTH.sato });
  test('プロフィールの「受取口座」が横にはみ出さず、登録できる。リンク（#bank）で開く', async ({ page }) => {
    await page.goto('/profile#bank');
    await expect(page.getByPlaceholder('みずほ銀行')).toBeVisible(); // the link opened the folded card
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.getByPlaceholder('みずほ銀行').fill(ACCOUNT.bank_name);
    await page.getByPlaceholder('0001').fill(ACCOUNT.bank_code);
    await page.getByPlaceholder('新宿支店').fill(ACCOUNT.branch_name);
    await page.getByPlaceholder('123', { exact: true }).fill(ACCOUNT.branch_code);
    await page.getByPlaceholder('1234567').fill(ACCOUNT.account_number);
    await page.getByPlaceholder('ヤマダ タロウ').fill(ACCOUNT.account_holder);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    expect(await db.user_bank_accounts.count()).toBe(1);
  });
});

test.describe('スマホ: 経理担当', () => {
  test.use({ storageState: AUTH.keiri });
  test('メニューに「振込データ」が出て、各タブが横にはみ出さない', async ({ page }) => {
    await makePayslip({ role: 'sato' });
    await page.goto('/threads');
    await page.locator('nav.md\\:hidden').first().getByRole('button', { name: 'メニュー' }).click();
    await page.getByRole('link', { name: '振込データ' }).click();
    await expect(page).toHaveURL(/\/transfers/);
    for (const tab of ['月次まとめ', '給与の振込', '支払の振込', '作成履歴', '受取口座の確認', '全銀の設定']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(300);
      expect(await hasHorizontalOverflow(page), tab).toBe(false);
    }
  });
});

test.describe('スマホ: 一般ユーザーのメニュー', () => {
  test.use({ storageState: AUTH.sato });
  test('「振込データ」は出ない', async ({ page }) => {
    await page.goto('/threads');
    await page.locator('nav.md\\:hidden').first().getByRole('button', { name: 'メニュー' }).click();
    await expect(page.getByRole('link', { name: '振込申請' })).toBeVisible();
    await expect(page.getByRole('link', { name: '振込データ' })).toHaveCount(0);
  });
});
