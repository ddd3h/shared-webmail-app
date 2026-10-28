import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { resetExpenses, resetPayslips, resetWork } from './helpers/seed';

// Switching tabs must not flash "nothing here" before the data arrives, nor pop in: a placeholder of the same size stands in, then the content fades in.
test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH.sato });
test.beforeEach(async () => { await resetExpenses(); await resetPayslips(); await resetWork(); });
test.afterAll(async () => { await resetExpenses(); await resetPayslips(); await resetWork(); });

const slow = (ms: number) => async (route: import('@playwright/test').Route) => { await new Promise(r => setTimeout(r, ms)); await route.continue(); };

test.describe('タブを切り替えても、ちらつかない', () => {
  test('給与明細: データが来るまでは「明細はまだありません」を出さず、同じ大きさの仮の表示が出て、来たら出る', async ({ page }) => {
    await page.goto('/work');
    await expect(page.getByRole('button', { name: '給与明細', exact: true })).toBeVisible();
    await page.route('**/api/work/payslips**', slow(900));
    await page.getByRole('button', { name: '給与明細', exact: true }).click();
    await expect(page.getByTestId('panel-skeleton')).toBeVisible();
    await expect(page.getByText('明細はまだありません')).toHaveCount(0);
    await expect(page.getByText('明細はまだありません')).toBeVisible({ timeout: 5000 });      // nothing to show: said only after the answer
    await expect(page.getByTestId('panel-skeleton')).toHaveCount(0);
  });

  test('経費: 切り替えの途中に「申請はありません」が出ない', async ({ page }) => {
    await db.expense_claims.create({ data: { user_id: USERS.sato.id, expense_date: new Date(), category: '交通費', title: 'ちらつき確認の申請', amount: 500, payment_method: 'personal', status: 'pending' } });
    await page.route('**/api/expenses?**', slow(700));
    await page.route('**/api/expenses', slow(700));
    await page.goto('/expenses');
    await expect(page.getByTestId('panel-skeleton')).toBeVisible();
    await expect(page.getByText('申請はありません')).toHaveCount(0);
    await expect(page.getByText('ちらつき確認の申請')).toBeVisible();
    await expect(page.getByText('申請はありません')).toHaveCount(0);
    await expect(page.getByTestId('panel-skeleton')).toHaveCount(0);
  });

  test('切り替えた中身は、ふわっと出る（フェードのアニメーションが付いている）', async ({ page }) => {
    await page.goto('/work');
    await page.getByRole('button', { name: '給与明細', exact: true }).click();
    const name = await page.locator('div.tab-fade').first().evaluate(el => getComputedStyle(el).animationName);
    expect(name).toBe('tab-fade-in');
  });

  test('動きを減らす設定の人には、アニメーションを付けない', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, reducedMotion: 'reduce', locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await page.getByRole('button', { name: '給与明細', exact: true }).click();
    const name = await page.locator('div.tab-fade').first().evaluate(el => getComputedStyle(el).animationName);
    expect(name).toBe('none');
    await ctx.close();
  });
});
