import type { Browser, Page } from '@playwright/test';
import * as Y from 'yjs';
import type { Prisma } from '@prisma/client';
import { test, expect } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';

// 本文の入力中に、カーソルが行や段落の頭へ飛んだり、打った文字が消えたりしないこと。
// 日本語は IME で打つので、変換中の文字（composition）を CDP で再現して打つ。

const PERSONAL = 'mb_sato_personal';
let threadId = '';

test.beforeAll(async () => {
  await db.mailboxes.deleteMany({ where: { id: PERSONAL } });
  await db.mailboxes.create({ data: { id: PERSONAL, type: 'personal', owner_user_id: USERS.sato.id, display_name: '佐藤個人', email_address: 'sato-personal@e2e.test', is_active: true } });
  await db.messages.deleteMany({}); await db.threads.deleteMany({});
  const at = new Date(Date.now() - 3600_000);
  const t = await db.threads.create({ data: { mailbox_id: MAILBOX_ID, subject: '共同編集の確認', normalized_subject: '共同編集の確認', last_message_at: at, last_received_at: at, unread_count: 1 } });
  threadId = t.id;
  await db.messages.create({ data: { thread_id: t.id, mailbox_id: MAILBOX_ID, external_message_id: '<collab@e2e.test>', direction: 'incoming', from_name: '送信者', from_email: 'x@example.com', to_raw: 'sales@e2e.test', subject: '共同編集の確認', text_body: 'こんにちは', sent_at: at, received_at: at } });
});
test.beforeEach(async () => { await db.drafts.deleteMany({}); });
test.afterAll(async () => {
  await db.drafts.deleteMany({});
  await db.messages.deleteMany({}); await db.threads.deleteMany({});
  await db.mailboxes.deleteMany({ where: { id: PERSONAL } });
});

// IME で text を打つ: 変換中の文字が1字ずつ伸びてから確定する
async function ime(page: Page, text: string, step = 30) {
  const cdp = await page.context().newCDPSession(page);
  for (let i = 1; i <= text.length; i++) {
    await cdp.send('Input.imeSetComposition', { text: text.slice(0, i), selectionStart: i, selectionEnd: i });
    await page.waitForTimeout(step);
  }
  await cdp.send('Input.insertText', { text });
  await cdp.detach();
}

const editorOf = (page: Page) => page.locator('.ProseMirror').first();
// the text of each paragraph, without the other people's carets (their name labels sit inside the text)
const paras = (page: Page) => editorOf(page).locator('p').evaluateAll(ps => ps.map(p => {
  const c = p.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.collaboration-carets__caret').forEach(e => e.remove());
  return c.textContent ?? '';
}));

async function openPage(browser: Browser, role: 'sato' | 'admin', opts: { blockCollab?: boolean } = {}) {
  const ctx = await browser.newContext({ storageState: AUTH[role] });
  const page = await ctx.newPage();
  // the collaboration socket: count what the server sends, so a test knows the room is really synced
  const synced = new Promise<void>(resolve => {
    page.on('websocket', ws => {
      if (!ws.url().includes('webmail-draft-')) return;
      ws.on('framereceived', () => resolve());
    });
  });
  // the collaboration server cannot be reached (production today: nginx has no /collab): the socket goes to a closed port.
  // (done in the page, not with Playwright's request routing, so the requests a closing page sends are not touched)
  if (opts.blockCollab) {
    await ctx.addInitScript(() => {
      const Real = window.WebSocket;
      window.WebSocket = class extends Real {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(String(url).includes('webmail-draft-') ? 'ws://127.0.0.1:9/' : url, protocols);
        }
      };
    });
  }
  return { ctx, page, synced };
}

// the body stored with a draft (its Yjs state), as text; by default the reply draft of the thread
async function storedText(where: Prisma.draftsWhereInput = { thread_id: threadId }) {
  const d = await db.drafts.findFirst({ where, select: { yjs_state: true } });
  if (!d?.yjs_state) return '';
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(d.yjs_state));
  return doc.getXmlFragment('default').toString();
}

const LINES = ['一行目の本文です。', '二行目を打っています。', '三行目で終わりです。'];

// one line per pause: each pause lets the draft autosave (and, for a shared draft, the room come up)
async function typeLinesWithPauses(page: Page) {
  for (const [i, line] of LINES.entries()) {
    await ime(page, line);
    if (i < LINES.length - 1) await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
  }
}

test('個人メール: IME で打って手を止めても、文字は消えず、続きは文末に入る', async ({ browser }) => {
  const { ctx, page } = await openPage(browser, 'sato');
  await page.goto('/threads?compose=someone@example.com');
  await editorOf(page).waitFor();
  await page.locator(`select:has(option[value="${PERSONAL}"])`).selectOption(PERSONAL);
  await editorOf(page).click();
  await typeLinesWithPauses(page);
  expect(await paras(page)).toEqual(LINES);
  await ctx.close();
});

test('共有メール（同期あり）: IME で打って手を止めても、文字は消えず、続きは文末に入る', async ({ browser }) => {
  const { ctx, page, synced } = await openPage(browser, 'sato');
  await page.goto('/threads?compose=someone@example.com');
  await editorOf(page).waitFor();
  await page.locator(`select:has(option[value="${MAILBOX_ID}"])`).selectOption(MAILBOX_ID);
  await editorOf(page).click();
  await typeLinesWithPauses(page);
  await synced; // the room really came up during the typing
  expect(await paras(page)).toEqual(LINES);
  await ctx.close();
});

test('共有メール（共同編集サーバーにつながらない）: 文字は消えず、続きは文末に入る', async ({ browser }) => {
  const { ctx, page } = await openPage(browser, 'sato', { blockCollab: true });
  await page.goto('/threads?compose=someone@example.com');
  await editorOf(page).waitFor();
  await page.locator(`select:has(option[value="${MAILBOX_ID}"])`).selectOption(MAILBOX_ID);
  await editorOf(page).click();
  await typeLinesWithPauses(page);
  expect(await paras(page)).toEqual(LINES);
  await ctx.close();
});

// both open the reply of the same shared thread: they share one draft (one room)
async function openReply(browser: Browser, role: 'sato' | 'admin', opts: { blockCollab?: boolean } = {}) {
  const o = await openPage(browser, role, opts);
  await o.page.goto(`/threads/${threadId}`);
  await o.page.getByText('返信を入力…').click();
  await editorOf(o.page).waitFor();
  if (!opts.blockCollab) await o.synced;
  return o;
}

test('共有メールの返信を2人で: 別々の段落を同時に打っても、互いの文字が混ざらず、カーソルも飛ばない', async ({ browser }) => {
  const a = await openReply(browser, 'sato');
  const b = await openReply(browser, 'admin');
  await editorOf(a.page).click();
  await ime(a.page, '甲の段落。');
  await a.page.keyboard.press('Enter');
  await ime(a.page, '乙の段落。');
  await expect.poll(() => paras(b.page)).toEqual(['甲の段落。', '乙の段落。']);

  // a: the end of the first paragraph; b: the end of the second
  await a.page.keyboard.press('ArrowUp'); await a.page.keyboard.press('End');
  await editorOf(b.page).click(); await b.page.keyboard.press('Control+End');
  const X = 'ここは佐藤さんが続けて打っている文章です';
  const Y = 'こちらは管理者が同じ時に打っている文章です';
  await Promise.all([ime(a.page, X, 40), ime(b.page, Y, 40)]);

  const want = ['甲の段落。' + X, '乙の段落。' + Y];
  await expect.poll(() => paras(a.page), { timeout: 5000 }).toEqual(want);
  await expect.poll(() => paras(b.page), { timeout: 5000 }).toEqual(want);
  await a.ctx.close(); await b.ctx.close();
});

test('共有メールの返信を2人で: 同じ段落の頭と終わりを同時に打っても、どちらの文字も続いたまま', async ({ browser }) => {
  const a = await openReply(browser, 'sato');
  const b = await openReply(browser, 'admin');
  await editorOf(a.page).click();
  await ime(a.page, '真ん中の文。');
  await expect.poll(() => paras(b.page)).toEqual(['真ん中の文。']);

  await editorOf(b.page).click(); await b.page.keyboard.press('Control+Home');
  const X = '佐藤さんが文末に足している文章です';
  const Y = '管理者が文頭に足している文章です';
  await Promise.all([ime(a.page, X, 40), ime(b.page, Y, 40)]);

  const want = [Y + '真ん中の文。' + X];
  await expect.poll(() => paras(a.page), { timeout: 5000 }).toEqual(want);
  await expect.poll(() => paras(b.page), { timeout: 5000 }).toEqual(want);
  await a.ctx.close(); await b.ctx.close();
});

test('共有メールの返信: 打っている途中にもう1人が開いても、打っている人のカーソルは飛ばない', async ({ browser }) => {
  const a = await openReply(browser, 'sato');
  await editorOf(a.page).click();
  await ime(a.page, '最初の段落です。');
  await a.page.keyboard.press('Enter');
  const X = '二人目が入ってくる間も打ち続けている長めの文章です';
  const typing = ime(a.page, X, 60);
  await a.page.waitForTimeout(300);
  const b = await openReply(browser, 'admin');
  await typing;

  const want = ['最初の段落です。', X];
  await expect.poll(() => paras(a.page), { timeout: 5000 }).toEqual(want);
  await expect.poll(() => paras(b.page), { timeout: 5000 }).toEqual(want);
  await a.ctx.close(); await b.ctx.close();
});

// Production today: the collaboration server cannot be reached. Each browser edits on its own, and the body only travels through the saved draft.
test.describe('共同編集サーバーにつながらないとき（本文は保存された下書きで受け渡す）', () => {
  test('共有メールの返信: 開いてすぐ打ち始めても、文字は消えず、続きは文末に入る', async ({ browser }) => {
    const { ctx, page } = await openReply(browser, 'sato', { blockCollab: true });
    await editorOf(page).click();
    await typeLinesWithPauses(page);
    expect(await paras(page)).toEqual(LINES);
    await ctx.close();
  });

  test('打ってすぐ返信を閉じても本文は保存され、あとで開いた人に見える', async ({ browser }) => {
    const a = await openReply(browser, 'sato', { blockCollab: true });
    await editorOf(a.page).click();
    await ime(a.page, 'すぐ閉じても残る文。');
    await expect.poll(() => paras(a.page)).toEqual(['すぐ閉じても残る文。']);
    await a.page.getByRole('button', { name: /キャンセル/ }).click(); // closes well before the save delay (2 s) is over
    await expect.poll(() => storedText(), { timeout: 5000 }).toContain('すぐ閉じても残る文。');
    await a.ctx.close();

    const b = await openReply(browser, 'admin', { blockCollab: true });
    await expect.poll(() => paras(b.page)).toEqual(['すぐ閉じても残る文。']);
    await b.ctx.close();
  });

  test('2人が互いの文字を見ないまま同じ返信を直しても、保存された本文にはどちらの文も残る', async ({ browser }) => {
    const a = await openReply(browser, 'sato', { blockCollab: true });
    const b = await openReply(browser, 'admin', { blockCollab: true });
    await editorOf(a.page).click();
    await ime(a.page, '佐藤が書いた文。');
    await expect.poll(() => storedText(), { timeout: 8000 }).toContain('佐藤が書いた文。');
    // b's copy has never seen a's text: its save is merged into the stored body, not written over it
    await editorOf(b.page).click();
    await ime(b.page, '管理者が書いた文。');
    await expect.poll(() => storedText(), { timeout: 8000 }).toContain('管理者が書いた文。');
    expect(await storedText()).toContain('佐藤が書いた文。');
    await a.ctx.close(); await b.ctx.close();

    const c = await openReply(browser, 'sato', { blockCollab: true });
    await expect.poll(async () => (await paras(c.page)).join('')).toContain('佐藤が書いた文。');
    expect((await paras(c.page)).join('')).toContain('管理者が書いた文。');
    await c.ctx.close();
  });
});

const fromSelect = (page: Page, id: string) => page.locator(`select:has(option[value="${id}"])`).selectOption(id);

test.describe('From の切り替え・下書きを開き直す・転送・送信', () => {
  test('個人から共有へ From を変えても、打った文は残り、続きを打てる', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, 'sato');
    await page.goto('/threads?compose=someone@example.com');
    await editorOf(page).waitFor();
    await fromSelect(page, PERSONAL);
    await editorOf(page).click();
    await ime(page, '個人で打った文。');
    await page.waitForTimeout(1500);
    await fromSelect(page, MAILBOX_ID);
    await expect.poll(() => paras(page)).toEqual(['個人で打った文。']);
    await editorOf(page).click(); await page.keyboard.press('Control+End');
    await ime(page, '共有で続けた文。');
    await expect.poll(() => paras(page)).toEqual(['個人で打った文。共有で続けた文。']);
    await expect.poll(() => storedText({ mailbox_id: MAILBOX_ID }), { timeout: 8000 }).toContain('個人で打った文。共有で続けた文。');
    await ctx.close();
  });

  test('共有から個人へ From を変えても、打った文は残り、続きを打てる', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, 'sato');
    await page.goto('/threads?compose=someone@example.com');
    await editorOf(page).waitFor();
    await fromSelect(page, MAILBOX_ID);
    await editorOf(page).click();
    await ime(page, '共有で打った文。');
    await page.waitForTimeout(2500);
    await fromSelect(page, PERSONAL);
    await expect.poll(() => paras(page)).toEqual(['共有で打った文。']);
    await editorOf(page).click(); await page.keyboard.press('Control+End');
    await ime(page, '個人で続けた文。');
    await expect.poll(() => paras(page)).toEqual(['共有で打った文。個人で続けた文。']);
    await expect.poll(async () => (await db.drafts.findFirst({ where: { mailbox_id: PERSONAL } }))?.html_body ?? '', { timeout: 8000 }).toContain('共有で打った文。個人で続けた文。');
    await ctx.close();
  });

  for (const [kind, box] of [['共有', MAILBOX_ID], ['個人', PERSONAL]] as const) {
    test(`${kind}の下書きを下書き一覧から開き直すと、本文が出て、続きを打てる`, async ({ browser }) => {
      const { ctx, page } = await openPage(browser, 'sato');
      await page.goto('/threads?compose=someone@example.com');
      await editorOf(page).waitFor();
      await fromSelect(page, box);
      await page.getByPlaceholder('件名を入力').fill(`${kind}の下書き`);
      await editorOf(page).click();
      await ime(page, '最初に打った文。');
      await expect.poll(async () => {
        const d = await db.drafts.findFirst({ where: { mailbox_id: box } });
        return box === MAILBOX_ID ? storedText({ mailbox_id: box }) : (d?.html_body ?? '');
      }, { timeout: 8000 }).toContain('最初に打った文。');
      await page.getByRole('button', { name: /キャンセル/ }).click();

      await page.goto('/threads?tab=drafts');
      await page.getByText(`${kind}の下書き`).filter({ visible: true }).first().click();
      await expect.poll(() => paras(page)).toEqual(['最初に打った文。']);
      await editorOf(page).click(); await page.keyboard.press('Control+End');
      await ime(page, '開き直して足した文。');
      await expect.poll(() => paras(page)).toEqual(['最初に打った文。開き直して足した文。']);
      await ctx.close();
    });
  }

  test('共有メールの転送: 転送する本文が残り、その上に打った文も保存される', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, 'sato');
    await page.goto(`/threads/${threadId}`);
    await page.getByTitle('転送').click();
    await editorOf(page).waitFor();
    const bodyText = () => editorOf(page).evaluate(el => el.textContent ?? '');
    await expect.poll(bodyText).toContain('こんにちは'); // the forwarded message
    await editorOf(page).click(); await page.keyboard.press('Control+Home');
    await ime(page, '転送します。');
    await page.waitForTimeout(3000); // the draft is made and the room joined meanwhile
    const text = await bodyText();
    expect(text.startsWith('転送します。')).toBe(true);
    expect(text).toContain('こんにちは');
    await expect.poll(() => storedText({ mailbox_id: MAILBOX_ID, thread_id: null }), { timeout: 8000 }).toContain('転送します。');
    expect(await storedText({ mailbox_id: MAILBOX_ID, thread_id: null })).toContain('こんにちは');
    await ctx.close();
  });

  test('共有メールを送ると、打った本文がそのまま送られ、下書きは消える', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, 'sato');
    let sentHtml = '';
    await page.route('**/api/messages/compose', async route => {
      sentHtml = route.request().postDataBuffer()?.toString('utf8') ?? '';
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/threads?compose=someone@example.com');
    await editorOf(page).waitFor();
    await fromSelect(page, MAILBOX_ID);
    await page.getByPlaceholder('件名を入力').fill('送る共有メール');
    await editorOf(page).click();
    await ime(page, '送る本文です。');
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect.poll(() => sentHtml, { timeout: 15000 }).toContain('送る本文です。');
    await expect.poll(() => db.drafts.count({ where: { mailbox_id: MAILBOX_ID } }), { timeout: 8000 }).toBe(0);
    await page.waitForTimeout(3000); // a late save must not bring the draft back
    expect(await db.drafts.count({ where: { mailbox_id: MAILBOX_ID } })).toBe(0);
    await ctx.close();
  });
});
