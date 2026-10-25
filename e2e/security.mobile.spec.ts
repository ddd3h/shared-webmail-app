import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { hasHorizontalOverflow } from './helpers/ui';

test.describe('スマホ', () => {
  test.describe('管理者', () => {
    test.use({ storageState: AUTH.admin });
    test('セキュリティ画面が横にはみ出さない', async ({ page }) => {
      await page.goto('/admin/security');
      await expect(page.getByRole('heading', { level: 1, name: 'セキュリティ' })).toBeVisible();
      await page.waitForTimeout(500);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });
  test.describe('一般ユーザー', () => {
    test.use({ storageState: AUTH.sato });
    test('プロフィールのセキュリティ欄が横にはみ出さない', async ({ page }) => {
      await page.goto('/profile');
      await expect(page.getByLabel('セキュリティ', { exact: true })).toBeVisible();
      await page.waitForTimeout(500);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });
});
