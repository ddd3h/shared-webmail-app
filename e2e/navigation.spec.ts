import { test, expect } from './fixtures';
import { AUTH, ROLES, USERS, type Role } from './helpers/constants';
import { hasHorizontalOverflow } from './helpers/ui';

const NAV = ['メール', 'カレンダー', '勤怠・給与', '経費', '出張', '振込', '連絡帳', '通知', '予約送信', 'プロフィール'];

const PAGES: { path: string; link: string; heading: string | RegExp }[] = [
  { path: '/calendar', link: 'カレンダー', heading: 'カレンダー' },
  { path: '/work', link: '勤怠・給与', heading: '勤怠・給与' },
  { path: '/expenses', link: '経費', heading: '経費申請' },
  { path: '/trips', link: '出張', heading: '出張申請' },
  { path: '/payments', link: '振込', heading: '振込申請' },
  { path: '/contacts', link: '連絡帳', heading: '連絡帳' },
  { path: '/scheduled', link: '予約送信', heading: '予約送信' },
];

const header = (page: import('@playwright/test').Page) => page.locator('header nav');

test.describe('PCのナビゲーション', () => {
  for (const role of ROLES) {
    test.describe(`${USERS[role].name}（${USERS[role].role === 'admin' ? '管理者' : '一般'}）`, () => {
      test.use({ storageState: AUTH[role] });

      test('メニューに共通の項目が並び、「管理」は管理者にだけ表示される', async ({ page }) => {
        await page.goto('/threads');
        const nav = header(page);
        for (const label of NAV) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
        const admin = nav.getByRole('link', { name: '管理', exact: true });
        if (USERS[role].role === 'admin') await expect(admin).toBeVisible(); else await expect(admin).toHaveCount(0);
        // 振込データ（全銀）は管理者と経理担当にだけ
        const transfers = nav.getByRole('link', { name: '振込データ', exact: true });
        if (USERS[role].role === 'admin' || USERS[role].is_accounting) await expect(transfers).toBeVisible(); else await expect(transfers).toHaveCount(0);
      });
    });
  }

  test.describe('各ページへの移動', () => {
    test.use({ storageState: AUTH.sato });
    for (const p of PAGES) {
      test(`「${p.link}」をクリックすると ${p.path} が開き、見出しと現在地の強調が出る`, async ({ page }) => {
        await page.goto('/threads');
        await header(page).getByRole('link', { name: p.link, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(p.path));
        await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
        await expect(header(page).getByRole('link', { name: p.link, exact: true })).toHaveClass(/bg-blue-50/);
      });
    }

    test('「通知」「プロフィール」も開ける', async ({ page }) => {
      await page.goto('/threads');
      await header(page).getByRole('link', { name: '通知', exact: true }).click();
      await expect(page).toHaveURL(/\/notifications/);
      await header(page).getByRole('link', { name: 'プロフィール', exact: true }).click();
      await expect(page).toHaveURL(/\/profile/);
    });

    test('現在地以外のリンクは強調されない', async ({ page }) => {
      await page.goto('/expenses');
      await expect(header(page).getByRole('link', { name: 'カレンダー', exact: true })).not.toHaveClass(/bg-blue-50/);
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
