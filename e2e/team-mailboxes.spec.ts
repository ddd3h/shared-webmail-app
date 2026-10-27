import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';

test.describe.configure({ mode: 'serial' });

import { BOX_NAMES, GENERAL, SUBJECT, SUPPORT, cleanup, seed } from './helpers/team-mailboxes';

test.beforeEach(seed);
test.afterAll(cleanup);

const list = async (c: APIRequestContext, q = '') => (await (await c.get(`/api/threads?type=team&unread=1${q}`)).json()) as { items: { subject: string; mailbox_id: string }[]; totalCount: number };
const subjects = (r: { items: { subject: string }[] }) => r.items.map(i => i.subject).sort();
const all3 = [SUBJECT[MAILBOX_ID], SUBJECT[SUPPORT], SUBJECT[GENERAL]].sort();

test.describe('表示するメールボックス（API）', () => {
  test('見られる共有メールボックスが、名前順に、表示中・未読数つきで返る。見られない人には空', async ({ as }) => {
    const d = await (await (await as('sato')).get('/api/mailboxes/team-view')).json();
    expect(d.items.map((m: { id: string; name: string }) => `${m.id}|${m.name}`).sort()).toEqual([`${GENERAL}|総務共有`, `${MAILBOX_ID}|営業チーム共有`, `${SUPPORT}|サポート共有`].sort());
    expect(d.items).toHaveLength(3);
    expect(d.items.every((m: { shown: boolean; unread: number }) => m.shown && m.unread === 1)).toBe(true);
    expect((await (await (await as('tanaka')).get('/api/mailboxes/team-view')).json()).items.map((m: { id: string }) => m.id).sort()).toEqual([GENERAL, MAILBOX_ID].sort());
    expect((await (await (await as('suzuki')).get('/api/mailboxes/team-view')).json()).items).toEqual([]);
  });

  test('外したメールボックスは、共有メールの一覧・件数・未読の数から消える。検索には出る。自分だけの設定', async ({ as }) => {
    const sato = await as('sato');
    expect(subjects(await list(sato))).toEqual(all3);
    expect((await (await sato.get('/api/threads/unread-counts')).json()).team).toBe(3);
    const res = await sato.put('/api/mailboxes/team-view', { data: { hidden: [SUPPORT] } });
    expect(res.status()).toBe(200);
    expect((await res.json()).items.find((m: { id: string }) => m.id === SUPPORT).shown).toBe(false);

    const r = await list(sato);
    expect(subjects(r)).toEqual([SUBJECT[MAILBOX_ID], SUBJECT[GENERAL]].sort());
    expect(r.totalCount).toBe(2);
    expect((await (await sato.get('/api/threads/unread-counts')).json()).team).toBe(2);
    expect((await (await sato.get('/api/threads?type=team&all=1')).json()).items.map((i: { subject: string }) => i.subject)).not.toContain(SUBJECT[SUPPORT]);
    // a search looks in every mailbox the person may view
    expect(subjects(await (await sato.get(`/api/threads?type=team&q=${encodeURIComponent('サポート')}`)).json())).toEqual([SUBJECT[SUPPORT]]);
    // personal view and other people are not affected
    expect(subjects(await list(await as('tanaka')))).toEqual([SUBJECT[MAILBOX_ID], SUBJECT[GENERAL]].sort());
    expect(await db.hidden_team_mailboxes.count({ where: { user_id: USERS.tanaka.id } })).toBe(0);
    // put them back
    await sato.put('/api/mailboxes/team-view', { data: { hidden: [] } });
    expect(subjects(await list(sato))).toEqual(all3);
  });

  test('チップ（mailbox_id）でその1つだけに絞れる。外したものも、指定すれば出る', async ({ as }) => {
    const sato = await as('sato');
    await sato.put('/api/mailboxes/team-view', { data: { hidden: [GENERAL] } });
    expect(subjects(await list(sato, `&mailbox_id=${SUPPORT}`))).toEqual([SUBJECT[SUPPORT]]);
    expect(subjects(await list(sato, `&mailbox_id=${GENERAL}`))).toEqual([SUBJECT[GENERAL]]);
    // another person's mailbox cannot be reached this way
    expect((await list(await as('tanaka'), `&mailbox_id=${SUPPORT}`)).items).toEqual([]);
  });

  test('全部は外せない（400）。見られないメールボックスのIDは無視される。形式が違えば400', async ({ as }) => {
    const sato = await as('sato');
    expect((await sato.put('/api/mailboxes/team-view', { data: { hidden: [MAILBOX_ID, SUPPORT, GENERAL] } })).status()).toBe(400);
    expect(await db.hidden_team_mailboxes.count()).toBe(0);
    const tanaka = await as('tanaka');
    const res = await tanaka.put('/api/mailboxes/team-view', { data: { hidden: [SUPPORT, 'nope'] } });   // tanaka cannot view サポート
    expect(res.status()).toBe(200);
    expect(await db.hidden_team_mailboxes.count({ where: { user_id: USERS.tanaka.id } })).toBe(0);
    expect((await tanaka.put('/api/mailboxes/team-view', { data: { hidden: [MAILBOX_ID, GENERAL] } })).status()).toBe(400);
    for (const bad of [{}, { hidden: 'x' }, { hidden: [1] }]) expect((await sato.put('/api/mailboxes/team-view', { data: bad })).status(), JSON.stringify(bad)).toBe(400);
    expect((await (await as('suzuki')).put('/api/mailboxes/team-view', { data: { hidden: [] } })).status()).toBe(200);
  });

  test('「すべて既読」などの一括操作は、見えているものだけが対象（外したものは触らない）', async ({ as }) => {
    const sato = await as('sato');
    await sato.put('/api/mailboxes/team-view', { data: { hidden: [SUPPORT] } });
    const res = await sato.post('/api/threads/bulk', { data: { action: 'read', all: true, filters: { type: 'team', unread: '1', mine: '0', sent: '0', assigned: '0', spam: '0' } } });
    expect(res.status()).toBe(200);
    expect(await db.thread_reads.count({ where: { user_id: USERS.sato.id } })).toBe(2);
    const supportThread = await db.threads.findFirst({ where: { mailbox_id: SUPPORT } });
    expect(await db.thread_reads.count({ where: { thread_id: supportThread!.id } })).toBe(0);
    // narrowed by a chip: only that mailbox
    await seed();
    await sato.post('/api/threads/bulk', { data: { action: 'read', all: true, filters: { type: 'team', unread: '1', mailbox_id: GENERAL } } });
    const reads = await db.thread_reads.findMany({ where: { user_id: USERS.sato.id }, include: { thread: true } });
    expect(reads.map(r => r.thread.mailbox_id)).toEqual([GENERAL]);
  });
});

const chips = (page: Page) => page.getByTestId('team-mailbox-chips');
const subject = (page: Page, text: string) => page.getByText(text).locator('visible=true').first();

test.describe('画面', () => {
  test.use({ storageState: AUTH.sato });

  test('共有メールに、メールボックスのチップが出る。選ぶとそのメールボックスだけになり、「すべて」で戻る', async ({ page }) => {
    await page.goto('/threads');
    await page.getByRole('button', { name: /共有メール/ }).click();
    await expect(chips(page)).toBeVisible();
    for (const name of Object.values(BOX_NAMES)) await expect(chips(page).getByRole('button', { name })).toBeVisible();
    await expect(chips(page).getByRole('button', { name: /^すべて/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(subject(page, SUBJECT[SUPPORT])).toBeVisible();
    await expect(subject(page, SUBJECT[GENERAL])).toBeVisible();
    await chips(page).getByRole('button', { name: /サポート共有/ }).click();
    await expect(subject(page, SUBJECT[SUPPORT])).toBeVisible();
    await expect(page.getByText(SUBJECT[GENERAL])).toHaveCount(0);
    await expect(page.getByText(SUBJECT[MAILBOX_ID])).toHaveCount(0);
    await chips(page).getByRole('button', { name: /^すべて/ }).click();
    await expect(subject(page, SUBJECT[GENERAL])).toBeVisible();
  });

  test('「表示を選ぶ」でメールボックスを外すと、チップも一覧も未読の数も変わり、開き直しても続く。全部は外せない', async ({ page }) => {
    await page.goto('/threads');
    await page.getByRole('button', { name: /共有メール/ }).click();
    await chips(page).getByRole('button', { name: '表示を選ぶ' }).click();
    const dialog = page.getByRole('dialog', { name: '共有メールに表示するメールボックス' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/総務共有/).uncheck();
    await dialog.getByRole('button', { name: '保存' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(chips(page).getByRole('button', { name: /総務共有/ })).toHaveCount(0);
    await expect(page.getByText(SUBJECT[GENERAL])).toHaveCount(0);
    await expect(subject(page, SUBJECT[SUPPORT])).toBeVisible();
    await expect(page.getByRole('button', { name: /共有メール/ }).locator('span.rounded-full')).toHaveText('2');
    await page.reload();
    await page.getByRole('button', { name: /共有メール/ }).click();
    await expect(chips(page).getByRole('button', { name: /総務共有/ })).toHaveCount(0);
    // not all of them
    await chips(page).getByRole('button', { name: '表示を選ぶ' }).click();
    const d2 = page.getByRole('dialog', { name: '共有メールに表示するメールボックス' });
    await d2.getByLabel(/営業チーム共有/).uncheck();
    await d2.getByLabel(/サポート共有/).uncheck();
    await d2.getByLabel(/総務共有/).check();
    await d2.getByLabel(/総務共有/).uncheck();   // everything unchecked
    await d2.getByRole('button', { name: '保存' }).click();
    await expect(d2.getByRole('alert')).toContainText('少なくとも1つは表示してください');
    await d2.getByLabel(/総務共有/).check();     // put one back and it saves
    await d2.getByRole('button', { name: '保存' }).click();
    await expect(d2).toHaveCount(0);
    await expect(chips(page).getByRole('button', { name: /総務共有/ })).toBeVisible();
    await expect(chips(page).getByRole('button', { name: /営業チーム共有/ })).toHaveCount(0);
  });

  test('共有メールボックスが1つしか見られない人には、チップは出ない', async ({ browser }) => {
    await db.mailbox_permissions.deleteMany({ where: { mailbox_id: GENERAL, user_id: USERS.tanaka.id } });   // tanaka: 営業だけ
    const ctx = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/threads');
    await page.getByRole('button', { name: /共有メール/ }).click();
    await expect(subject(page, SUBJECT[MAILBOX_ID])).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
    await ctx.close();
  });

  test('検索中はチップを出さず、外したメールボックスも検索には出る', async ({ page }) => {
    await (await page.request.put('/api/mailboxes/team-view', { data: { hidden: [GENERAL] } })).ok();
    await page.goto('/threads');
    await page.getByRole('button', { name: /共有メール/ }).click();
    await expect(page.getByText(SUBJECT[GENERAL])).toHaveCount(0);
    await page.getByPlaceholder(/検索/).first().fill('総務の備品');
    await page.keyboard.press('Enter');
    await expect(subject(page, SUBJECT[GENERAL])).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
  });
});
