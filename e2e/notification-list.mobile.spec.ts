import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';

test.use({ storageState: AUTH.sato });
test.beforeEach(async () => { await db.notification_events.deleteMany({}); });
test.afterAll(async () => { await db.notification_events.deleteMany({}); });

const give = (title: string, o: { read?: boolean } = {}) => db.notification_events.create({ data: { user_id: USERS.sato.id, event_type: 'todo_assigned', title, body: 'ほげ', url: '/todos', priority: 'normal', read_at: o.read ? new Date() : null } });

test.describe('スマホ: 通知', () => {
  test('メニューのボタンに赤い点、シートの「通知」に数。開くと一覧が出て、横にはみ出さない', async ({ page }) => {
    await give('一つ目'); await give('二つ目'); await give('読んだ', { read: true });
    await page.goto('/threads');
    const menuBtn = page.getByRole('button', { name: 'メニュー' });
    await expect(menuBtn.locator('span.bg-red-600')).toBeVisible();
    await menuBtn.click();
    const link = page.getByRole('link', { name: /^通知/ });
    await expect(link.getByTestId('notification-badge')).toHaveText('2');
    await link.click();
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByRole('list', { name: '通知の一覧' }).getByRole('button')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // a row is a big tap target
    const box = await page.getByRole('list', { name: '通知の一覧' }).getByRole('button').first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(56);
  });

  test('すべて既読にすると、赤い点が消える', async ({ page }) => {
    await give('一つ目');
    await page.goto('/notifications');
    await page.getByRole('button', { name: 'すべて既読にする' }).click();
    await expect(page.getByRole('button', { name: 'メニュー' }).locator('span.bg-red-600')).toBeHidden();
  });
});
