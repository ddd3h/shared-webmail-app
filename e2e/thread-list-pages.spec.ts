import { test, expect } from './fixtures';
import { MAILBOX_ID } from './helpers/constants';
import { db } from './helpers/db';

// The mail list and the search (GET /api/threads): 50 per page, the next page continues with no repeats, and the count is right.
// The threads are read first and their relations after (relationLoadStrategy 'query'), so the first sender must still be there.

test.describe.configure({ mode: 'serial' });

const N = 60;
type Item = { id: string; subject: string; from_name: string | null; last: string };
type Page = { items: Item[]; nextCursor: { last: string; id: string } | null; totalCount: number };

test.beforeAll(async () => {
  await db.drafts.deleteMany({});
  await db.messages.deleteMany({}); await db.threads.deleteMany({});
  for (let i = 0; i < N; i++) {
    const at = new Date(Date.now() - (i + 1) * 60_000); // thread 0 is the newest
    const subject = `一覧の確認 ${String(i).padStart(2, '0')}`;
    const t = await db.threads.create({ data: { mailbox_id: MAILBOX_ID, subject, normalized_subject: subject, last_message_at: at, last_received_at: at, unread_count: 0 } });
    // the first mail (the sender shown in the list), and a later reply from someone else
    await db.messages.create({ data: { thread_id: t.id, mailbox_id: MAILBOX_ID, external_message_id: `<p${i}a@e2e.test>`, direction: 'incoming', from_name: `差出人${i}`, from_email: `s${i}@example.com`, to_raw: 'sales@e2e.test', subject, text_body: i < 3 ? `請求書を送ります。Invoice No.${i}` : '本文です', sent_at: new Date(at.getTime() - 30_000), received_at: at } });
    await db.messages.create({ data: { thread_id: t.id, mailbox_id: MAILBOX_ID, external_message_id: `<p${i}b@e2e.test>`, direction: 'incoming', from_name: '返信した人', from_email: 'r@example.com', to_raw: 'sales@e2e.test', subject: `Re: ${subject}`, text_body: '返信です', sent_at: at, received_at: at } });
  }
});
test.afterAll(async () => { await db.messages.deleteMany({}); await db.threads.deleteMany({}); });

test('一覧: 1ページ目は新しい50件で、最初の差出人が付き、件数は60', async ({ as }) => {
  const p: Page = await (await (await as('sato')).get('/api/threads?type=team')).json();
  expect(p.items).toHaveLength(50);
  expect(p.totalCount).toBe(N);
  expect(p.items[0]).toMatchObject({ subject: '一覧の確認 00', from_name: '差出人0' });
  expect(p.items[49]).toMatchObject({ subject: '一覧の確認 49', from_name: '差出人49' });
  expect(p.nextCursor).not.toBeNull();
});

test('一覧: 2ページ目は続きの10件で、1ページ目と重ならず、件数は60のまま', async ({ as }) => {
  const c = await as('sato');
  const p1: Page = await (await c.get('/api/threads?type=team')).json();
  const p2: Page = await (await c.get(`/api/threads?type=team&cursor=${encodeURIComponent(p1.nextCursor!.last)}&cursor_id=${p1.nextCursor!.id}`)).json();
  expect(p2.items.map(i => i.subject)).toEqual(Array.from({ length: 10 }, (_, i) => `一覧の確認 ${50 + i}`));
  expect(p2.items.every(i => i.from_name?.startsWith('差出人'))).toBe(true);
  const seen = new Set(p1.items.map(i => i.id));
  expect(p2.items.some(i => seen.has(i.id))).toBe(false);
  expect(p2.totalCount).toBe(N);
  expect(p2.nextCursor).toBeNull();
});

test('検索: 漢字の語も英字の語も見つかり、英字は大文字・小文字を区別しない', async ({ as }) => {
  const c = await as('sato');
  const search = async (q: string): Promise<Page> => (await c.get(`/api/threads?type=team&q=${encodeURIComponent(q)}`)).json();
  for (const q of ['請求書', 'Invoice', 'INVOICE', 'invoice']) {
    const p = await search(q);
    expect(p.items.map(i => i.subject), q).toEqual(['一覧の確認 00', '一覧の確認 01', '一覧の確認 02']);
    expect(p.totalCount, q).toBe(3);
  }
  // more than one page of hits: the count is still all of them
  const many = await search('一覧の確認');
  expect(many.items).toHaveLength(50);
  expect(many.totalCount).toBe(N);
  expect((await search('見つからない語')).totalCount).toBe(0);
});
