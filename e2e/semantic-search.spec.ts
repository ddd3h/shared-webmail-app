import { test, expect } from './fixtures';
import { AUTH, MAILBOX_ID } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH.sato });

const T = {
  invoice: { subject: '請求書の送付', body: '今月分の請求書をお送りします' },
  pay: { subject: 'お願い', body: '代金のお振込をお願いします' },
  meeting: { subject: '打ち合わせの日程', body: '来週の会議について' },
};

async function seed() {
  await db.thread_reads.deleteMany({});
  await db.messages.deleteMany({});
  await db.threads.deleteMany({});
  for (const [i, t] of Object.values(T).entries()) {
    const at = new Date(Date.now() - (i + 1) * 3600_000);
    const thread = await db.threads.create({ data: { mailbox_id: MAILBOX_ID, subject: t.subject, normalized_subject: t.subject, last_message_at: at, last_received_at: at, unread_count: 1 } });
    await db.messages.create({ data: { thread_id: thread.id, mailbox_id: MAILBOX_ID, external_message_id: `<sem-${i}@e2e.test>`, direction: 'incoming', from_name: `送信者${i}`, from_email: `s${i}@example.com`, to_raw: 'sales@e2e.test', subject: t.subject, text_body: t.body, sent_at: at, received_at: at } });
  }
}
const index = (request: import('@playwright/test').APIRequestContext) =>
  request.get('/api/cron/embeddings', { headers: { authorization: 'Bearer e2e-cron-secret' } });

test.beforeEach(async () => { await mm.reset(); await seed(); });
test.afterAll(async () => { await db.messages.deleteMany({}); await db.threads.deleteMany({}); });

const row = (page: import('@playwright/test').Page, text: string) => page.getByText(text).locator('visible=true').first();
async function search(page: import('@playwright/test').Page, q: string) {
  await page.goto('/threads');
  await page.getByPlaceholder(/検索…/).fill(q);
  await page.getByPlaceholder(/検索…/).press('Enter');
}

test.describe('意味検索のしくみ', () => {
  test('インデックス作成は秘密の鍵がないと実行できない', async ({ request }) => {
    expect((await request.get('/api/cron/embeddings')).status()).toBe(401);
    expect((await request.get('/api/cron/embeddings', { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401);
  });

  test('スレッドごとに1つベクトルができ、変更がなければ作り直さない', async ({ request }) => {
    const first = await (await index(request)).json();
    expect(first).toMatchObject({ ok: true, enabled: true, indexed: 3, pending: 0 });
    expect(await db.thread_embeddings.count()).toBe(3);
    const calls = await mm.embeddingCalls();
    expect((await (await index(request)).json()).indexed).toBe(0);
    expect(await mm.embeddingCalls()).toBe(calls);
  });

  test('新しいメールが届いたスレッドだけ作り直す', async ({ request }) => {
    await index(request);
    const thread = await db.threads.findFirstOrThrow({ where: { subject: T.meeting.subject } });
    await new Promise(r => setTimeout(r, 50));
    await db.threads.update({ where: { id: thread.id }, data: { last_message_at: new Date() } });
    expect((await (await index(request)).json()).indexed).toBe(1);
  });

  test('見られないメールボックスのスレッドは、意味が近くても出ない', async ({ as, request }) => {
    await index(request);
    const sato = await as('sato');
    const mine = await (await sato.get('/api/threads?type=team&q=インボイス&semantic=1')).json();
    expect(mine.items.map((i: { subject: string }) => i.subject).sort()).toEqual([T.invoice.subject, T.pay.subject].sort());
    const suzuki = await as('suzuki');
    const theirs = await (await suzuki.get('/api/threads?type=team&q=インボイス&semantic=1')).json();
    expect(theirs.items).toEqual([]);
  });

  test('from: などの絞り込みは意味検索にも効く', async ({ as, request }) => {
    await index(request);
    const sato = await as('sato');
    const r = await (await sato.get(`/api/threads?type=team&q=${encodeURIComponent('インボイス from:s1@example.com')}&semantic=1`)).json();
    expect(r.items.map((i: { subject: string }) => i.subject)).toEqual([T.pay.subject]);
  });

  test('semantic=1 でなければ今までどおり（意味の近いものは出さない）', async ({ as, request }) => {
    await index(request);
    const sato = await as('sato');
    const r = await (await sato.get('/api/threads?type=team&q=インボイス')).json();
    expect(r.items).toEqual([]);
    expect(r.semantic).toBeUndefined();
  });
});

test.describe('意味検索の画面', () => {
  test('言葉が含まれるメールのあとに、内容が近いメールが「意味」付きで並ぶ', async ({ page, request }) => {
    await index(request);
    await search(page, '請求書');
    await expect(row(page, T.invoice.subject)).toBeVisible();
    await expect(row(page, T.pay.subject)).toBeVisible();
    await expect(page.getByText('意味が近いメール').locator('visible=true')).toBeVisible();
    await expect(row(page, T.meeting.subject)).toBeHidden();
    // the word hit comes first
    const y = async (t: string) => (await row(page, t).boundingBox())!.y;
    expect(await y(T.invoice.subject)).toBeLessThan(await y(T.pay.subject));
  });

  test('スイッチを切るとキーワード検索だけになり、その選択は覚えている', async ({ page, request }) => {
    await index(request);
    await search(page, 'インボイス');
    await expect(row(page, T.invoice.subject)).toBeVisible();
    await page.getByLabel(/意味検索/).uncheck();
    await expect(page.getByText('メールはありません')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/意味検索/)).not.toBeChecked();
  });

  test('意味検索のサービスが落ちていても、キーワード検索は使えて、お知らせが出る', async ({ page, request }) => {
    await index(request);
    await mm.failEmbeddings(true);
    await search(page, '請求書の');
    await expect(row(page, T.invoice.subject)).toBeVisible();
    await expect(page.getByText(/意味検索を一時的に使えません/)).toBeVisible();
    await expect(page.getByText('意味が近いメール')).toBeHidden();
  });
});
