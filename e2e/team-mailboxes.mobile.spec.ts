import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { BOX_NAMES, GENERAL, SUBJECT, SUPPORT, cleanup, seed } from './helpers/team-mailboxes';
import { hasHorizontalOverflow } from './helpers/ui';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH.sato });
test.beforeEach(seed);
test.afterAll(cleanup);

test.describe('スマホ: 共有メールのメールボックス', () => {
  test('チップが横に並び（はみ出さない）、選ぶと絞られ、「表示を選ぶ」は下から出るシートで、外すとチップが消える', async ({ page }) => {
    await page.goto('/threads');
    await page.locator('button', { hasText: '共有メール' }).first().click();
    const chips = page.getByTestId('team-mailbox-chips');
    await expect(chips).toBeVisible();
    for (const name of Object.values(BOX_NAMES)) await expect(chips.getByRole('button', { name })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await chips.getByRole('button', { name: /サポート共有/ }).click();
    await expect(page.getByText(SUBJECT[SUPPORT]).locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(SUBJECT[GENERAL])).toHaveCount(0);

    await chips.getByRole('button', { name: '表示を選ぶ' }).click();
    const sheet = page.getByRole('dialog', { name: '共有メールに表示するメールボックス' });
    await expect(sheet).toBeVisible();
    const box = await sheet.locator('> div').boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 2);   // it sits at the bottom of the screen
    await sheet.getByLabel(/サポート共有/).uncheck();
    await sheet.getByRole('button', { name: '保存' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(chips.getByRole('button', { name: /サポート共有/ })).toHaveCount(0);
    // the chip that was chosen is gone, so the list is back to everything that is shown
    await expect(page.getByText(SUBJECT[GENERAL]).locator('visible=true').first()).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
