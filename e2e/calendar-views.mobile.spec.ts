import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { db } from './helpers/db';
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

test.describe('スマホ: 操作は隠しておいて、必要なときに出す', () => {
  test('はじめは操作ボタンが並ばず、「表示の設定」のシートで人の絞り込みとToDoの表示を選ぶ', async ({ page }) => {
    await page.goto(`/calendar?mailbox=mb_team&view=day&date=${today()}`); // the members' calendars: that is where people can be hidden
    await expect(page.getByTestId('grid-event').filter({ hasText: '全体会議' })).toBeVisible();
    // what a wide screen shows in the page header / above the grid is folded away
    for (const name of ['Google連携', '＋ 予定', '＋ ToDo', '自分のみ', '全員']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByLabel('ToDoも表示')).toBeHidden();

    await page.getByRole('button', { name: '表示の設定' }).click();
    const sheet = page.getByRole('dialog', { name: '表示の設定' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: '自分のみ' }).click();
    await sheet.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByTestId('grid-event').filter({ hasText: '全体会議' })).toHaveCount(0); // 副管理者の予定は「自分」のではない
    await expect(page.getByLabel('絞り込み中')).toBeVisible(); // the dot on the button says something is hidden

    await page.getByRole('button', { name: '表示の設定' }).click();
    await page.getByRole('dialog', { name: '表示の設定' }).getByRole('button', { name: '全員' }).click();
    await page.getByRole('dialog', { name: '表示の設定' }).getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByTestId('grid-event').filter({ hasText: '全体会議' })).toBeVisible();
    await expect(page.getByLabel('絞り込み中')).toHaveCount(0);
  });

  test('月は点で予定の有無を示し、日をタップすると下にその日の予定が出る。追加は丸い「＋」から選ぶ', async ({ page }) => {
    await page.goto(`/calendar?view=month&date=${today()}`);
    const cell = page.locator(`main .grid-cols-7 button[data-date="${today()}"]`);
    await expect(cell).toBeVisible();
    await expect(cell.getByTestId('todo-chip')).toBeHidden();
    await expect(page.locator('aside').getByText('週次ミーティング')).toBeVisible();
    await page.getByRole('button', { name: '追加', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '追加する' });
    await expect(sheet.getByRole('option', { name: /予定/ })).toBeVisible();
    await sheet.getByRole('option', { name: /ToDo/ }).click();
    await expect(page.getByRole('dialog', { name: 'ToDoを追加' })).toBeVisible();
    await expect(page.getByLabel(/期限/)).toHaveValue(today());
  });

  test('見るカレンダーは、名前をタップして選べる（自分のカレンダー／共有メールのメンバー）', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page.getByRole('button', { name: /自分のカレンダー/ })).toBeVisible();
    await page.getByRole('button', { name: /自分のカレンダー/ }).click();
    await page.getByRole('option', { name: '営業チーム共有 のメンバー' }).click();
    await expect(page.getByRole('button', { name: /営業チーム共有 のメンバー/ })).toBeVisible();
    await expect(page.locator('aside').getByText('週次ミーティング')).toBeVisible();
  });
});
