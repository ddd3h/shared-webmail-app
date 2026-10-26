import { test, expect, uniq } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { hasHorizontalOverflow, today } from './helpers/ui';

test.beforeEach(async () => { await db.todos.deleteMany({}); });
test.afterAll(async () => { await db.todos.deleteMany({}); });

test.describe('スマホ: ToDo', () => {
  test.use({ storageState: AUTH.sato });

  test('メニューからToDoを開き、追加・完了ができて、横にはみ出さない', async ({ page }) => {
    await page.goto('/threads');
    await page.locator('nav.fixed').getByRole('button', { name: 'メニュー' }).click();
    await page.locator('div.fixed.inset-0.z-60').getByRole('link', { name: 'ToDo' }).click();
    await expect(page).toHaveURL(/\/todos/);
    const title = uniq('スマホで追加');
    await page.getByLabel('ToDoをすばやく追加').fill(title + 'とても長い内容'.repeat(8));
    await page.getByLabel('ToDoをすばやく追加').press('Enter');
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await row.getByRole('checkbox').click();
    await expect(row).toHaveCount(0);
  });

  test('カレンダーに期限のToDoが出て、横にはみ出さない', async ({ page }) => {
    const title = uniq('今日が期限');
    await db.todos.create({ data: { mailbox_id: MAILBOX_ID, title, due_date: new Date(`${today()}T00:00:00Z`), assignee_id: USERS.sato.id } });
    await page.goto('/calendar');
    await expect(page.getByLabel('この日のToDo')).toContainText(title);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
