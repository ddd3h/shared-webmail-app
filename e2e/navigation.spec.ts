import { test, expect } from './fixtures';
import { AUTH, ROLES, USERS, type Role } from './helpers/constants';
import { resetOrg } from './helpers/seed';
import { hasHorizontalOverflow, openAccountMenu, openOrgMenu, openWorkMenu } from './helpers/ui';

test.beforeAll(async () => { await resetOrg(); }); // the menu tests assume nobody heads a unit

const TOP_LEVEL = ['メール', 'カレンダー', '連絡帳', '通知'];
const WORK_MENU = ['勤怠・給与', '経費', '出張', '振込申請'];
const ACCOUNT_MENU = ['予約送信', 'プロフィール'];

const PAGES: { path: string; link: string; heading: string | RegExp; menu?: 'work' }[] = [
  { path: '/calendar', link: 'カレンダー', heading: 'カレンダー' },
  { path: '/work', link: '勤怠・給与', heading: '勤怠・給与', menu: 'work' },
  { path: '/expenses', link: '経費', heading: '経費申請', menu: 'work' },
  { path: '/trips', link: '出張', heading: '出張申請', menu: 'work' },
  { path: '/payments', link: '振込申請', heading: '振込申請', menu: 'work' },
  { path: '/contacts', link: '連絡帳', heading: '連絡帳' },
];

type Page = import('@playwright/test').Page;
const header = (page: Page) => page.locator('header');
const bar = (page: Page) => page.locator('header nav').first();

test.describe('PCのナビゲーション', () => {
  for (const role of ROLES) {
    test.describe(`${USERS[role].name}（${USERS[role].role === 'admin' ? '管理者' : '一般'}）`, () => {
      test.use({ storageState: AUTH[role] });

      test('上のバーには主要な項目だけが並ぶ（細かい項目はまとめメニューの中）', async ({ page }) => {
        await page.goto('/threads');
        for (const label of TOP_LEVEL) await expect(header(page).getByRole('link', { name: label, exact: true })).toBeVisible();
        await expect(header(page).getByRole('button', { name: /申請・給与/ })).toBeVisible();
        await expect(header(page).getByRole('button', { name: 'アカウントメニュー' })).toBeVisible();
        // closed by default: nothing from the groups is in the bar
        for (const label of [...WORK_MENU, ...ACCOUNT_MENU, '管理', '振込データ']) await expect(header(page).getByRole('link', { name: label, exact: true })).toHaveCount(0);
        await expect(header(page).getByRole('button', { name: /組織・人事/ })).toBeVisible();
        for (const label of ['組織', '人事評価']) await expect(header(page).getByRole('link', { name: label, exact: true })).toHaveCount(0);
        // top bar = 3 links + the two group buttons (the bell and the account button sit outside the nav)
        await expect(bar(page).locator('a, button')).toHaveCount(5);
      });

      test('「申請・給与」を開くと勤怠・経費・出張・振込申請が並ぶ。「振込データ」は管理者と経理担当だけ', async ({ page }) => {
        await page.goto('/threads');
        await openWorkMenu(page);
        for (const label of WORK_MENU) await expect(header(page).getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
        const transfers = header(page).getByRole('link', { name: /^振込データ/ });
        if (USERS[role].role === 'admin' || USERS[role].is_accounting) await expect(transfers).toBeVisible(); else await expect(transfers).toHaveCount(0);
      });

      test('「組織・人事」を開くと組織・人事評価がある。承認のメニューは権限のある人だけ', async ({ page }) => {
        await page.goto('/threads');
        await openOrgMenu(page);
        for (const label of ['組織', '人事評価']) await expect(header(page).getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
        await openWorkMenu(page);
        // nobody has a unit in this test, so only admins can approve
        const approvals = header(page).getByRole('link', { name: /^チームの承認/ });
        if (USERS[role].role === 'admin') await expect(approvals).toBeVisible(); else await expect(approvals).toHaveCount(0);
      });

      test('アカウントメニューに予約送信・プロフィール・ログアウトがあり、「管理」は管理者だけ', async ({ page }) => {
        await page.goto('/threads');
        await openAccountMenu(page);
        for (const label of ACCOUNT_MENU) await expect(header(page).getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
        await expect(header(page).getByRole('button', { name: 'ログアウト' })).toBeVisible();
        const admin = header(page).getByRole('link', { name: /^管理/ });
        if (USERS[role].role === 'admin') await expect(admin).toBeVisible(); else await expect(admin).toHaveCount(0);
      });
    });
  }

  test.describe('メニューの動き', () => {
    test.use({ storageState: AUTH.sato });

    for (const p of PAGES) {
      test(`「${p.link}」を開くと ${p.path} に移動し、見出しと現在地の強調が出る`, async ({ page }) => {
        await page.goto('/threads');
        if (p.menu) await openWorkMenu(page);
        await header(page).getByRole('link', { name: new RegExp(`^${p.link}`) }).first().click();
        await expect(page).toHaveURL(new RegExp(p.path));
        await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
        if (p.menu) {
          // the group button is highlighted, and the menu has closed itself after the click
          await expect(header(page).getByRole('button', { name: /申請・給与/ })).toHaveClass(/bg-blue-50/);
          await expect(header(page).getByRole('link', { name: /^経費/ })).toHaveCount(0);
        } else {
          await expect(header(page).getByRole('link', { name: p.link, exact: true })).toHaveClass(/bg-blue-50/);
        }
      });
    }

    test('開いている項目は menu の中でも現在地として強調される', async ({ page }) => {
      await page.goto('/expenses');
      await openWorkMenu(page);
      await expect(header(page).getByRole('link', { name: /^経費/ })).toHaveClass(/bg-blue-50/);
      await expect(header(page).getByRole('link', { name: /^出張/ })).not.toHaveClass(/bg-blue-50/);
    });

    test('メニューは Escape・外側クリック・もう一度のクリックで閉じる', async ({ page }) => {
      await page.goto('/threads');
      const trigger = header(page).getByRole('button', { name: /申請・給与/ });
      const item = header(page).getByRole('link', { name: /^経費/ });
      await trigger.click(); await expect(item).toBeVisible(); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape'); await expect(item).toHaveCount(0); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click(); await expect(item).toBeVisible();
      await page.locator('main').click({ position: { x: 5, y: 300 } }); await expect(item).toHaveCount(0);
      await trigger.click(); await expect(item).toBeVisible();
      await trigger.click(); await expect(item).toHaveCount(0);
    });

    test('2つのメニューは同時に開かない', async ({ page }) => {
      await page.goto('/threads');
      await openWorkMenu(page);
      await openAccountMenu(page);
      await expect(header(page).getByRole('link', { name: /^経費/ })).toHaveCount(0);
      await expect(header(page).getByRole('link', { name: /^プロフィール/ })).toBeVisible();
    });

    test('「通知」「プロフィール」「予約送信」も開ける', async ({ page }) => {
      await page.goto('/threads');
      await header(page).getByRole('link', { name: '通知', exact: true }).click();
      await expect(page).toHaveURL(/\/notifications/);
      await openAccountMenu(page);
      await header(page).getByRole('link', { name: /^プロフィール/ }).click();
      await expect(page).toHaveURL(/\/profile/);
      await openAccountMenu(page);
      await header(page).getByRole('link', { name: /^予約送信/ }).click();
      await expect(page).toHaveURL(/\/scheduled/);
    });

    test('アカウントメニューにユーザー名が出る', async ({ page }) => {
      await page.goto('/threads');
      await openAccountMenu(page);
      await expect(header(page).getByText('佐藤 さん')).toBeVisible();
    });

    test('現在地以外のリンクは強調されない', async ({ page }) => {
      await page.goto('/expenses');
      await expect(header(page).getByRole('link', { name: 'カレンダー', exact: true })).not.toHaveClass(/bg-blue-50/);
    });

    test('キーボードで Tab を押すと、メニューのボタンに順に移動できる', async ({ page }) => {
      await page.goto('/threads');
      const trigger = header(page).getByRole('button', { name: /申請・給与/ });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(header(page).getByRole('link', { name: /^勤怠・給与/ })).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(header(page).getByRole('link', { name: /^勤怠・給与/ })).toBeFocused();
    });
  });
});

test.describe('画面幅ごとにメニューがはみ出さない', () => {
  test.use({ storageState: AUTH.admin });
  for (const width of [768, 800, 900, 1024, 1280, 1536]) {
    for (const path of ['/calendar', '/work', '/expenses', '/trips', '/payments']) {
      test(`幅${width}px の ${path} は横スクロールが出ない`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        expect(await hasHorizontalOverflow(page)).toBe(false);
      });
    }
  }
});

test.describe('ページの基本表示', () => {
  test.use({ storageState: AUTH.sato });
  for (const p of PAGES) {
    test(`${p.path} は200で表示され、コンソールエラーがない`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      const res = await page.goto(p.path);
      expect(res!.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('存在しないページは404になる', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res!.status()).toBe(404);
  });
});
