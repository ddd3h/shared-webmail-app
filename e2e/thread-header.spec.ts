import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH, MAILBOX_ID } from './helpers/constants';
import { db } from './helpers/db';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH.sato });

let threadId = '';
test.beforeAll(async () => {
  await db.messages.deleteMany({}); await db.threads.deleteMany({});
  const at = new Date(Date.now() - 3600_000);
  const t = await db.threads.create({ data: { mailbox_id: MAILBOX_ID, subject: 'スクロールの確認用メール', normalized_subject: 'スクロールの確認用メール', last_message_at: at, last_received_at: at, unread_count: 1 } });
  threadId = t.id;
  const body = Array.from({ length: 160 }, (_, i) => `${i + 1}行目: 長い本文です。スクロールしても、上の見出しの位置が動かないことを確かめます。`).join('\n');
  await db.messages.create({ data: { thread_id: t.id, mailbox_id: MAILBOX_ID, external_message_id: '<scroll@e2e.test>', direction: 'incoming', from_name: '送信者', from_email: 'x@example.com', to_raw: 'a@e2e.test', subject: 'スクロールの確認用メール', text_body: body, sent_at: at, received_at: at } });
});
test.afterAll(async () => { await db.messages.deleteMany({}); await db.threads.deleteMany({}); });

// the top of the sticky header (the row with the subject), measured while scrolling
const headerTop = (page: Page) => page.evaluate(() => {
  const h1 = document.querySelector('h1');
  const bar = h1?.closest('.sticky') as HTMLElement | null;
  return bar ? Math.round(bar.getBoundingClientRect().top) : null;
});

test.describe('メールを開いてスクロールしても、上の見出しの位置はずれない', () => {
  test('PC: 最初の位置と、スクロールしたあとの位置が同じ（上のメニューの直下）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/threads/${threadId}`);
    await expect(page.getByRole('heading', { name: 'スクロールの確認用メール' })).toBeVisible();
    const nav = await page.evaluate(() => Math.round(document.querySelector('header')!.getBoundingClientRect().bottom));
    const start = await headerTop(page);
    expect(start).toBe(nav);
    for (const y of [10, 60, 300, 900]) {
      await page.evaluate(v => window.scrollTo(0, v), y);
      await page.waitForTimeout(150);
      expect(await headerTop(page), `scrollY=${y}`).toBe(nav);
    }
  });

  test('スマホ: 画面の一番上に付いたまま、位置が変わらない', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto(`/threads/${threadId}`);
    await expect(page.getByRole('heading', { name: 'スクロールの確認用メール' })).toBeVisible();
    const start = await headerTop(page);
    expect(start).toBe(0);
    for (const y of [10, 60, 300, 900]) {
      await page.evaluate(v => window.scrollTo(0, v), y);
      await page.waitForTimeout(150);
      expect(await headerTop(page), `scrollY=${y}`).toBe(0);
    }
    await ctx.close();
  });
});
