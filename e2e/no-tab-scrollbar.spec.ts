import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';

// A row of tabs that scrolls sideways must not draw a scrollbar: on a computer a visible bar (even a vertical one, from a 1px overlap)
// makes the tabs look scrollable.
test.describe('タブの行にスクロールバーが出ない', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 1280, height: 800 } });

  for (const path of ['/expenses', '/trips', '/work', '/payments', '/transfers', '/org', '/evaluations', '/threads']) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.overflow-x-auto'))
        .filter(el => /(^|\s)(border-b|-mx-2|gap-1\.5)(\s|$)/.test(el.className) || el.tagName === 'NAV')
        .filter(el => el.className.includes('flex'))
        .map(el => ({ cls: el.className, bar: getComputedStyle(el).scrollbarWidth, hidden: getComputedStyle(el, '::-webkit-scrollbar').display })));
      expect(rows.length, path).toBeGreaterThan(0);
      for (const r of rows) expect(r.bar === 'none' || r.hidden === 'none', r.cls).toBe(true);
    });
  }
});
