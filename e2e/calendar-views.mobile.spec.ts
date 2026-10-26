import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { seedCalendar } from './helpers/seed';
import { hasHorizontalOverflow, today } from './helpers/ui';

test.beforeEach(async () => { await seedCalendar(); });
test.afterAll(async () => { await seedCalendar(); });
test.use({ storageState: AUTH.admin });

test.describe('スマホ: カレンダーの日・週・月', () => {
  test('3つの表示を切り替えても、ページが横にはみ出さない（週は枠の中で横にスクロール）', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'カレンダー' })).toBeVisible();
    const switcher = page.getByRole('group', { name: '表示の切り替え' });
    for (const l of ['週', '日', '月']) {
      await switcher.getByRole('button', { name: l, exact: true }).click();
      await page.waitForTimeout(300);
      expect(await hasHorizontalOverflow(page), l).toBe(false);
    }
    await switcher.getByRole('button', { name: '週', exact: true }).click();
    await expect(page.getByTestId('day-column')).toHaveCount(7);
    await expect(page.getByTestId('grid-event').filter({ hasText: '週次ミーティング' })).toBeVisible();
  });

  test('日表示で予定が見え、前の日・次の日で動ける', async ({ page }) => {
    await page.goto(`/calendar?view=day&date=${today()}`);
    await expect(page.getByTestId('grid-event').filter({ hasText: '週次ミーティング' })).toBeVisible();
    await page.getByRole('button', { name: '次の日' }).click();
    await expect(page.getByTestId('grid-event').filter({ hasText: '週次ミーティング' })).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
