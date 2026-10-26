import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';

test.use({ storageState: AUTH.sato });

test.describe('スマホ: メール一覧の検索は隠しておく', () => {
  test('はじめは検索欄がなく、虫めがねを押すと出て、もう一度押すと閉じる', async ({ page }) => {
    await page.goto('/threads');
    const field = page.getByPlaceholder(/検索…/);
    await expect(page.getByRole('button', { name: '検索を開く' })).toBeVisible();
    await expect(field).toBeHidden();
    await page.getByRole('button', { name: '検索を開く' }).click();
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await page.getByRole('button', { name: '検索を開く' }).click();
    await expect(field).toBeHidden();
  });
});
