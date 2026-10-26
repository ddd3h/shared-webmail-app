import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { hasHorizontalOverflow } from './helpers/ui';

const bottomBar = (page: import('@playwright/test').Page) => page.locator('nav.md\\:hidden').first();

test.describe('スマホの下部タブ', () => {
  test.use({ storageState: AUTH.sato });

  test('下のバーは メール・カレンダー・連絡先・メニュー の4つ', async ({ page }) => {
    await page.goto('/threads');
    const bar = bottomBar(page);
    await expect(bar.getByRole('link', { name: 'メール' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'カレンダー' })).toBeVisible();
    await expect(bar.getByRole('link', { name: '連絡先' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'メニュー' })).toBeVisible();
    await expect(bar.locator('a, button')).toHaveCount(4);
  });

  test('PC用の上部メニューはスマホでは表示されない', async ({ page }) => {
    await page.goto('/threads');
    await expect(page.locator('header')).toBeHidden();
  });

  test('「カレンダー」タブでカレンダーが開き、現在地が青くなる', async ({ page }) => {
    await page.goto('/threads');
    await bottomBar(page).getByRole('link', { name: 'カレンダー' }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(bottomBar(page).getByRole('link', { name: 'カレンダー' })).toHaveClass(/text-blue-600/);
    await expect(bottomBar(page).getByRole('link', { name: 'メール' })).not.toHaveClass(/text-blue-600/);
  });

  test('「連絡先」タブで連絡帳が開く', async ({ page }) => {
    await page.goto('/threads');
    await bottomBar(page).getByRole('link', { name: '連絡先' }).click();
    await expect(page).toHaveURL(/\/contacts/);
    await expect(page.getByRole('heading', { level: 1, name: '連絡帳' })).toBeVisible();
  });

  test('「メール」タブでメール一覧に戻れる', async ({ page }) => {
    await page.goto('/calendar');
    await bottomBar(page).getByRole('link', { name: 'メール' }).click();
    await expect(page).toHaveURL(/\/threads/);
  });
});

test.describe('スマホのメニューシート', () => {
  test.use({ storageState: AUTH.sato });

  async function openSheet(page: import('@playwright/test').Page) {
    await page.goto('/threads');
    await bottomBar(page).getByRole('button', { name: 'メニュー' }).click();
    const sheet = page.locator('div.fixed.inset-0.z-60');
    await expect(sheet).toBeVisible();
    return sheet;
  }

  test('通知・勤怠・給与・経費・出張・振込・予約送信・プロフィール・ログアウトが並ぶ', async ({ page }) => {
    const sheet = await openSheet(page);
    for (const l of ['通知', '勤怠・給与', '経費', '出張', '振込申請', '組織', '人事評価', '予約送信', 'プロフィール']) await expect(sheet.getByRole('link', { name: l })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'ログアウト' })).toBeVisible();
  });

  test('下のバーにあるカレンダー・連絡帳は、メニューには重複して出ない', async ({ page }) => {
    const sheet = await openSheet(page);
    await expect(sheet.getByRole('link', { name: 'カレンダー' })).toHaveCount(0);
    await expect(sheet.getByRole('link', { name: /連絡/ })).toHaveCount(0);
  });

  test('一般ユーザーには「管理」が出ない', async ({ page }) => {
    const sheet = await openSheet(page);
    await expect(sheet.getByRole('link', { name: '管理', exact: true })).toHaveCount(0);
  });

  for (const [label, url] of [['経費', /\/expenses/], ['出張', /\/trips/], ['振込申請', /\/payments/], ['勤怠・給与', /\/work/]] as const) {
    test(`メニューの「${label}」から移動すると、シートが閉じる`, async ({ page }) => {
      const sheet = await openSheet(page);
      await sheet.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(page.locator('div.fixed.inset-0.z-60')).toBeHidden();
    });
  }

  test('背景をタップするとシートが閉じる', async ({ page }) => {
    const sheet = await openSheet(page);
    await sheet.locator('div.absolute.inset-0').click({ position: { x: 10, y: 10 } });
    await expect(sheet).toBeHidden();
  });
});

test.describe('スマホのメニュー（管理者）', () => {
  test.use({ storageState: AUTH.admin });
  test('管理者には「管理」が表示される', async ({ page }) => {
    await page.goto('/threads');
    await bottomBar(page).getByRole('button', { name: 'メニュー' }).click();
    await expect(page.locator('div.fixed.inset-0.z-60').getByRole('link', { name: '管理', exact: true })).toBeVisible();
  });
});

test.describe('スマホで横スクロールが出ない', () => {
  test.use({ storageState: AUTH.admin });
  for (const path of ['/calendar', '/work', '/expenses', '/trips', '/payments', '/contacts', '/scheduled']) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(500);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  }
});
