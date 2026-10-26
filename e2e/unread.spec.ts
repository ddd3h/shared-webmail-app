import { test, expect } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH.sato });

const SUBJECTS = ['見積もりのご依頼', '請求書の送付', '打ち合わせの日程'];

async function seedUnread() {
  await db.thread_reads.deleteMany({});
  await db.messages.deleteMany({});
  await db.threads.deleteMany({});
  for (const [i, subject] of SUBJECTS.entries()) {
    const at = new Date(Date.now() - (i + 1) * 3600_000);
    const thread = await db.threads.create({ data: { mailbox_id: MAILBOX_ID, subject, normalized_subject: subject, last_message_at: at, last_received_at: at, unread_count: 1 } });
    await db.messages.create({ data: { thread_id: thread.id, mailbox_id: MAILBOX_ID, external_message_id: `<unread-${i}@e2e.test>`, direction: 'incoming', from_name: `送信者${i}`, from_email: `sender${i}@example.com`, to_raw: 'sales@e2e.test', subject, text_body: '本文', sent_at: at, received_at: at } });
  }
}
test.beforeEach(seedUnread);
test.afterAll(async () => { await db.thread_reads.deleteMany({}); await db.messages.deleteMany({}); await db.threads.deleteMany({}); });

// the number on the 「共有メール」 tab, as people see it ('' = no number)
const teamBadge = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /共有メール/ }).locator('span.rounded-full');
// each row is drawn twice (phone layout and wide layout); only one is visible
const subject = (page: import('@playwright/test').Page, text: string) => page.getByText(text).locator('visible=true').first();
const openTeam = async (page: import('@playwright/test').Page) => {
  await page.goto('/threads');
  await page.getByRole('button', { name: /共有メール/ }).click();
  await expect(subject(page, SUBJECTS[0])).toBeVisible();
};
// the app icon badge: what the page asked the browser to show last
const recordAppBadge = (page: import('@playwright/test').Page) => page.addInitScript(() => {
  const w = window as unknown as { __badge: number | null };
  w.__badge = null;
  Object.defineProperty(navigator, 'setAppBadge', { value: async (n: number) => { w.__badge = n; } });
  Object.defineProperty(navigator, 'clearAppBadge', { value: async () => { w.__badge = 0; } });
});
const appBadge = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __badge: number | null }).__badge);

test.describe('既読にしたら、未読の数がすぐ変わる（再読み込みなし）', () => {
  test('スレッドを開いて一覧に戻ると、タブの数が1つ減る', async ({ page }) => {
    await openTeam(page);
    await expect(teamBadge(page)).toHaveText('3');
    await subject(page, SUBJECTS[0]).click();
    await expect(page).toHaveURL(/\/threads\/[^/?]+/);
    await expect(page.getByText('本文').first()).toBeVisible();
    await page.goBack();
    await expect(subject(page, SUBJECTS[1])).toBeVisible();
    await expect(teamBadge(page)).toHaveText('2');
    await page.reload();
    await expect(teamBadge(page)).toHaveText('2'); // the same as after a reload
  });

  test('スレッドを開いた直後、画面に戻る前でもアプリのバッジ（ホーム画面の数）が減る', async ({ page }) => {
    await recordAppBadge(page);
    await openTeam(page);
    await expect.poll(() => appBadge(page)).toBe(3);
    await subject(page, SUBJECTS[1]).click();
    await expect(page.getByText('本文').first()).toBeVisible();
    await expect.poll(() => appBadge(page), { timeout: 5000 }).toBe(2);
  });

  test('一覧でまとめて既読にすると、タブの数とアプリのバッジが減る', async ({ page }) => {
    await recordAppBadge(page);
    await openTeam(page);
    await expect(teamBadge(page)).toHaveText('3');
    const rows = page.locator('div.group').filter({ hasText: SUBJECTS[0] });
    await rows.locator('visible=true').first().hover();
    await rows.locator('visible=true').first().locator('input[type=checkbox]:visible').first().click({ force: true });
    await page.getByRole('button', { name: '既読', exact: true }).locator('visible=true').first().click();
    await expect(teamBadge(page)).toHaveText('2');
    await expect.poll(() => appBadge(page)).toBe(2);
  });

  test('未読に戻すと、数が増える', async ({ page }) => {
    await openTeam(page);
    await subject(page, SUBJECTS[2]).click();
    await expect(page.getByText('本文').first()).toBeVisible();
    await page.getByTitle('未読にする').locator('visible=true').first().click();
    await expect(page).toHaveURL(/\/threads(\?|$)/);
    await expect(subject(page, SUBJECTS[1])).toBeVisible();
    await expect(teamBadge(page)).toHaveText('3');
  });

  test('サーバーの数え方: 読んだ人にだけ反映される（他の人の数は変わらない）', async ({ as }) => {
    const sato = await as('sato'), tanaka = await as('tanaka');
    const [t] = await db.threads.findMany({ take: 1 });
    expect((await (await sato.get('/api/threads/unread-counts')).json()).team).toBe(3);
    expect((await sato.post(`/api/threads/${t.id}/read`)).status()).toBe(200);
    expect((await (await sato.get('/api/threads/unread-counts')).json()).team).toBe(2);
    expect((await (await tanaka.get('/api/threads/unread-counts')).json()).team).toBe(3);
    expect(USERS.sato.id).toBeTruthy();
  });
});
