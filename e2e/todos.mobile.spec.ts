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
    await expect(page.getByLabel('ToDoをすばやく追加')).toBeHidden(); // the input row is for wide screens; a phone has the round button
    await page.getByRole('button', { name: 'ToDoを追加' }).click();
    await page.getByLabel('ToDoの内容').fill(title + 'とても長い内容'.repeat(8));
    await page.getByLabel('ToDoの内容').press('Enter'); // Enter saves
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

test.describe('スマホ: ToDoの絞り込みはシートから選ぶ', () => {
  test.use({ storageState: AUTH.sato });
  test('担当の絞り込みはボタンからシートで選び、選ぶと印が付く。状態は上のバーで切り替える', async ({ page }) => {
    await db.todos.createMany({ data: [
      { mailbox_id: MAILBOX_ID, title: '佐藤の仕事', assignee_id: USERS.sato.id },
      { mailbox_id: MAILBOX_ID, title: 'みんなの仕事', assignee_id: null },
    ] });
    await page.goto('/todos');
    await expect(page.getByText('みんなの仕事')).toBeVisible();
    await expect(page.getByLabel('担当で絞り込み')).toBeHidden(); // the wide-screen drop-down is not on a phone
    await page.getByRole('button', { name: /担当の絞り込みを開く/ }).click();
    await page.getByRole('option', { name: '自分' }).click();
    await expect(page.getByText('みんなの仕事')).toHaveCount(0);
    await expect(page.getByText('佐藤の仕事')).toBeVisible();
    await expect(page.getByRole('button', { name: /担当の絞り込みを開く（自分）/ })).toBeVisible();
    await page.getByRole('group', { name: '状態' }).getByRole('button', { name: '完了', exact: true }).click();
    await expect(page.getByText('佐藤の仕事')).toHaveCount(0);
  });
});
