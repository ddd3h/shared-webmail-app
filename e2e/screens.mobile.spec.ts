import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { hasHorizontalOverflow } from './helpers/ui';

type Page = import('@playwright/test').Page;
const fold = (page: Page, name: string | RegExp) => page.getByRole('button', { name, expanded: undefined }).filter({ has: page.locator('svg') }).first();

test.describe('スマホ: 申請の一覧（経費・出張・振込）', () => {
  test.use({ storageState: AUTH.sato });
  for (const [path, heading, create] of [['/expenses', '経費申請', '経費を申請'], ['/trips', '出張申請', '出張を申請'], ['/payments', '振込申請', '振込を申請']] as const) {
    test(`${heading}: 説明は隠れ、絞り込みは1行で横にスワイプ、申請は丸い「＋」`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('h1 + p')).toBeHidden(); // the one-line explanation is for wide screens
      const chips = page.getByRole('button', { name: /^(すべて|承認待ち|返金待ち|振込待ち|承認済|却下|取消|返金済|振込済)$/ });
      const ys = await chips.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2); // every chip on the same line
      expect(await hasHorizontalOverflow(page)).toBe(false);
      await expect(page.getByRole('button', { name: `＋ ${create}` })).toBeHidden();
      await page.locator(`button[aria-label="${create}"]`).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  }
});

test.describe('スマホ: 勤怠', () => {
  test.use({ storageState: AUTH.sato });
  test('打刻ボタンは2列の大きなボタン', async ({ page }) => {
    await page.goto('/work');
    const buttons = ['出勤', '休憩開始', '休憩終了', '退勤'].map(n => page.getByRole('button', { name: n, exact: true }));
    for (const b of buttons) await expect(b).toBeVisible();
    const boxes = await Promise.all(buttons.map(b => b.boundingBox()));
    expect(Math.round(boxes[0]!.y)).toBe(Math.round(boxes[1]!.y)); // two on a row
    expect(boxes[0]!.y).toBeLessThan(boxes[2]!.y);
    for (const b of boxes) expect(b!.height).toBeGreaterThanOrEqual(48);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe('スマホ: 長い画面は項目ごとに折りたたむ', () => {
  test.use({ storageState: AUTH.admin });

  test('セキュリティ: 項目は閉じていて、タップで開く。上の数字は見えたまま', async ({ page }) => {
    await page.goto('/admin/security');
    await expect(page.getByText('ログイン失敗（24時間）')).toBeVisible();
    await page.getByRole('tab', { name: 'アカウントと端末' }).click();
    const login = page.getByRole('region', { name: 'ログイン方法' });
    const header = login.getByRole('button', { name: /ログイン方法/ });
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(login.getByRole('listitem').first()).toBeHidden();
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(login.getByRole('listitem').first()).toBeVisible();
    await header.click();
    await expect(login.getByRole('listitem').first()).toBeHidden();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test('システム設定: 項目ごとに閉じていて、開くと入力欄が出る。閉じていても入力は残る', async ({ page }) => {
    await page.goto('/admin/settings');
    const basic = page.getByRole('button', { name: /アプリ基本設定/ });
    await expect(basic).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('アプリURL（NEXT_PUBLIC_APP_URL）')).toBeHidden();
    await basic.click();
    const field = page.getByPlaceholder('180').first();
    await expect(field).toBeVisible();
    await field.fill('321');
    await basic.click();
    await expect(field).toBeHidden();
    await basic.click();
    await expect(field).toHaveValue('321'); // what was typed is kept while folded
  });

  test('プロフィール: 項目ごとに折りたたまれ、パスワード変更を開ける', async ({ page }) => {
    await page.goto('/profile');
    const pw = page.getByRole('button', { name: /パスワード変更/ });
    await expect(pw).toHaveAttribute('aria-expanded', 'false');
    await pw.click();
    await expect(pw).toHaveAttribute('aria-expanded', 'true');
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
