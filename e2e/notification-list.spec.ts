import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { resetTransfers } from './helpers/seed';
import { postClaim } from './helpers/factories';
import { mm } from './helpers/mattermost-mock';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetTransfers(); await db.notification_events.deleteMany({}); await mm.reset(); });
test.afterAll(async () => { await db.notification_events.deleteMany({}); await mm.reset(); });

const give = (role: keyof typeof USERS, o: { title: string; body?: string; url?: string; type?: string; read?: boolean; ago?: number }) =>
  db.notification_events.create({ data: {
    user_id: USERS[role].id, event_type: o.type ?? 'expense_submitted', title: o.title, body: o.body ?? '', url: o.url ?? '/approvals', priority: 'normal',
    read_at: o.read ? new Date() : null, created_at: new Date(Date.now() - (o.ago ?? 0) * 60_000),
  } });

test.describe('通知の記録（API）', () => {
  test('申請のお知らせ（Mattermost のDMと同じもの）が、届く人の通知に残る。本人には出ない', async ({ as }) => {
    await postClaim(await as('sato'), { title: '通知一覧のテスト', amount: '3300' });
    await mm.waitFor(p => p.message.includes('通知一覧のテスト'));
    const admin = await (await (await as('admin')).get('/api/notifications')).json();
    expect(admin.unread).toBe(1);
    expect(admin.items[0]).toMatchObject({ type: 'expense_submitted', title: '🧾 経費申請が届きました', url: '/approvals', read: false });
    expect(admin.items[0].body).toContain('通知一覧のテスト');
    expect(admin.items[0].body).not.toContain('http');
    expect((await (await (await as('sato')).get('/api/notifications')).json()).items).toEqual([]);
  });

  test('Mattermost に繋がらなくても、通知には残る', async ({ as }) => {
    await mm.fail(true);
    await postClaim(await as('sato'), { title: '繋がらないとき' });
    await expect.poll(async () => (await (await (await as('admin')).get('/api/notifications')).json()).items.length).toBe(1);
  });

  test('新しい順。未読だけに絞れる。件数が多いときは続きを取れる', async ({ as }) => {
    for (let i = 0; i < 35; i++) await give('sato', { title: `通知${i}`, ago: 35 - i, read: i < 10 });
    const sato = await as('sato');
    const first = await (await sato.get('/api/notifications?limit=30')).json();
    expect(first.items).toHaveLength(30);
    expect(first.items[0].title).toBe('通知34');
    expect(first.unread).toBe(25);
    expect(first.next).toBeTruthy();
    const rest = await (await sato.get(`/api/notifications?limit=30&before=${encodeURIComponent(first.next)}`)).json();
    expect(rest.items.map((i: { title: string }) => i.title)).toEqual(Array.from({ length: 5 }, (_, i) => `通知${4 - i}`));
    expect(rest.next).toBeNull();
    const unread = await (await sato.get('/api/notifications?unread=1&limit=100')).json();
    expect(unread.items).toHaveLength(25);
    expect(unread.items.every((i: { read: boolean }) => !i.read)).toBe(true);
  });

  test('既読にできる。他の人の通知は既読にできない', async ({ as }) => {
    const mine = await give('sato', { title: '自分の' });
    const theirs = await give('admin', { title: '他人の' });
    const sato = await as('sato');
    const r = await (await sato.post('/api/notifications/read', { data: { ids: [mine.id, theirs.id] } })).json();
    expect(r).toEqual({ marked: 1, unread: 0 });
    expect((await db.notification_events.findUniqueOrThrow({ where: { id: theirs.id } })).read_at).toBeNull();
  });

  test('すべて既読。数は /unread-count で読める', async ({ as }) => {
    await give('sato', { title: 'a' }); await give('sato', { title: 'b' }); await give('admin', { title: 'c' });
    const sato = await as('sato');
    expect((await (await sato.get('/api/notifications/unread-count')).json()).count).toBe(2);
    expect(await (await sato.post('/api/notifications/read', { data: { all: true } })).json()).toEqual({ marked: 2, unread: 0 });
    expect((await (await sato.get('/api/notifications/unread-count')).json()).count).toBe(0);
    expect((await (await (await as('admin')).get('/api/notifications/unread-count')).json()).count).toBe(1);
  });

  test('ログインしていないと使えない。不正な指定は400', async ({ anon, as }) => {
    expect((await anon.get('/api/notifications', { maxRedirects: 0 })).status()).not.toBe(200);
    expect((await (await as('sato')).post('/api/notifications/read', { data: { ids: 'x' } })).status()).toBe(400);
    expect((await (await as('sato')).get('/api/notifications?before=not-a-date')).status()).toBe(400);
  });

  test('他のサイトへのリンクが入っていても、アプリの中のパスだけを返す', async ({ as }) => {
    await give('sato', { title: '危ないリンク', url: 'https://evil.example.net/x' });
    await give('sato', { title: '二重スラッシュ', url: '//evil.example.net/x' });
    const items = (await (await (await as('sato')).get('/api/notifications')).json()).items;
    expect(items.map((i: { url: string }) => i.url)).toEqual(['/notifications', '/notifications']);
  });
});

test.describe('通知の画面', () => {
  test.use({ storageState: AUTH.sato });

  test('一覧が出て、押すと移動して既読になり、ベルの数も減る。「すべて既読」もある', async ({ page }) => {
    await give('sato', { title: '🧾 経費申請が届きました', body: '山田 さん ・ ¥3,300', url: '/approvals', ago: 5 });
    await give('sato', { title: '📝 ToDoが割り当てられました', body: '見積を送る', url: '/todos', type: 'todo_assigned', ago: 60 });
    await give('sato', { title: '✅ 承認されました', url: '/expenses', type: 'expense_approved', read: true, ago: 600 });
    await page.goto('/notifications');
    const list = page.getByRole('list', { name: '通知の一覧' });
    await expect(list.getByRole('button')).toHaveCount(3);
    await expect(list.getByRole('button').first()).toContainText('経費申請が届きました');
    await expect(list.getByRole('button').first()).toContainText('5分前');
    await expect(list.locator('[data-unread="true"]')).toHaveCount(2);
    await expect(page.getByTestId('notification-badge').locator('visible=true').first()).toHaveText('2');

    await list.getByRole('button', { name: /ToDoが割り当てられました/ }).click();
    await expect(page).toHaveURL(/\/todos/);
    await page.goBack();
    await expect(page.getByRole('list', { name: '通知の一覧' }).locator('[data-unread="true"]')).toHaveCount(1);
    await expect(page.getByTestId('notification-badge').locator('visible=true').first()).toHaveText('1');

    await page.getByRole('button', { name: 'すべて既読にする' }).click();
    await expect(page.locator('[data-unread="true"]')).toHaveCount(0);
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);
    expect(await db.notification_events.count({ where: { user_id: USERS.sato.id, read_at: null } })).toBe(0);
  });

  test('「未読」タブは未読だけ。何もなければ空の表示', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByText('通知はまだありません')).toBeVisible();
    await give('sato', { title: '読んだもの', read: true }); await give('sato', { title: 'まだのもの' });
    await page.reload();
    await page.getByRole('tab', { name: /未読/ }).click();
    await expect(page.getByRole('list', { name: '通知の一覧' }).getByRole('button')).toHaveCount(1);
    await expect(page.getByText('読んだもの')).toBeHidden();
    await page.getByRole('button', { name: 'すべて既読にする' }).click();
    await expect(page.getByText('未読の通知はありません')).toBeVisible();
  });

  test('「設定」から、プロフィールの通知の項目へ行ける。通知設定の中身はそこにある', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByText('プッシュ通知とアプリのインストール')).toBeHidden();
    await page.getByRole('link', { name: '通知の設定' }).click();
    await expect(page).toHaveURL(/\/profile#notifications/);
    const section = page.getByLabel('プッシュ通知とアプリのインストール', { exact: true });
    await expect(section).toBeVisible();
    await expect(section.getByText(/ホーム画面|プッシュ通知|このブラウザ/).first()).toBeVisible();
  });
});
