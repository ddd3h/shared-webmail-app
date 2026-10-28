import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { CRITERIA, buildOrg, openCycle } from './helpers/org';
import { makeClaim } from './helpers/factories';
import { resetOrg } from './helpers/seed';
import { hasHorizontalOverflow } from './helpers/ui';

test.afterAll(async () => { await resetOrg(); }); // leave no organisation behind for the other specs
test.beforeEach(async () => { await resetOrg(); });

test.describe('スマホ: 管理者', () => {
  test.use({ storageState: AUTH.admin });
  test('組織の各タブ・評価の運用が横にはみ出さない', async ({ page, as }) => {
    await buildOrg(as);
    await openCycle(await as('keiri'));
    await page.goto('/org');
    for (const tab of ['組織図', '部署', '役職と権限', 'メンバー配置']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(250);
      expect(await hasHorizontalOverflow(page), tab).toBe(false);
    }
    await page.goto('/evaluations');
    await page.getByRole('button', { name: '評価の運用' }).click();
    await page.getByRole('button', { name: '進み具合を見る' }).click();
    await page.waitForTimeout(400);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe('スマホ: メンバーと部署長', () => {
  test.describe('メンバー', () => {
    test.use({ storageState: AUTH.tanaka });
    test('評価票を開いて点数をつけられ、はみ出さない', async ({ page, as }) => {
      await buildOrg(as);
      await openCycle(await as('keiri'));
      await page.goto('/evaluations');
      await page.getByRole('button', { name: /2026年度 上期/ }).click();
      await page.getByRole('button', { name: `${CRITERIA[0].name} 5点`, exact: true }).click();
      await expect(page.getByRole('button', { name: `${CRITERIA[0].name} 5点`, exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });

  test.describe('部署長', () => {
    test.use({ storageState: AUTH.sato });
    test('チームの承認が表示でき、はみ出さない', async ({ page, as }) => {
      await buildOrg(as);
      await makeClaim({ role: 'tanaka', status: 'pending', title: 'スマホで承認', amount: 1200 });
      await page.goto('/approvals');
      await expect(page.getByText('スマホで承認')).toBeVisible();
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });
});
