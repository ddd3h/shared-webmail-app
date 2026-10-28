import type { Browser, BrowserContext, Page } from '@playwright/test';
import { PASSWORD, USERS, type Role } from './constants';

// A random client IP per login so the per-IP rate limiter (20 / 15 min) is never the thing under test by accident.
export const fakeIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

export async function freshContext(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', extraHTTPHeaders: opts.storageState ? {} : { 'x-forwarded-for': fakeIp() }, ...opts });
  await ctx.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal{display:none!important}';
    const add = () => document.head.appendChild(style);
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  });
  return ctx;
}

export async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
}

export const loginAs = (page: Page, role: Role) => loginViaUi(page, USERS[role].email, PASSWORD);

export const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);

// Counts horizontal overflow of the whole page (a classic responsive-layout regression).
export const hasHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

// The app's labels are plain <label> elements sitting right before their field (no htmlFor), so getByLabel can't find them.
export const field = (scope: Page | import('@playwright/test').Locator, labelText: string | RegExp) =>
  scope.locator('label', { hasText: labelText }).first().locator('xpath=following-sibling::*[self::input or self::select or self::textarea][1]');

// ---- desktop top bar ----
// Work/money pages live under 「申請・給与」, personal pages and logout under the account menu; both are closed until clicked.
export const topBar = (page: Page) => page.locator('header nav').first();
export async function openWorkMenu(page: Page) {
  await page.locator('header').getByRole('button', { name: /申請・給与/ }).click();
}
export async function openAccountMenu(page: Page) {
  await page.locator('header').getByRole('button', { name: 'アカウントメニュー' }).click();
}
export async function openOrgMenu(page: Page) {
  await page.locator('header').getByRole('button', { name: /組織・人事/ }).click();
}
