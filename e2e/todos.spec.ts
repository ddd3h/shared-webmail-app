import { test, expect, uniq } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications } from './helpers/seed';
import { addDays, today } from './helpers/ui';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await db.todos.deleteMany({}); await clearNotifications(); await mm.reset(); });
test.afterAll(async () => { await db.todos.deleteMany({}); await mm.reset(); });

const body = (o: object = {}) => ({ mailboxId: MAILBOX_ID, title: uniq('ToDo'), ...o });
const list = async (c: import('@playwright/test').APIRequestContext, q = '') => (await (await c.get(`/api/todos?mailboxId=${MAILBOX_ID}${q}`)).json());
const make = async (c: import('@playwright/test').APIRequestContext, o: object = {}) => (await (await c.post('/api/todos', { data: body(o) })).json()).id as string;

// admin = edit rights, sato = edit rights, admin2 and tanaka = view only, suzuki = no access to the team mailbox
test.describe('ToDoのAPI', () => {
  test('作る・一覧に出る。担当・期限・メモも保存される', async ({ as }) => {
    const admin = await as('admin');
    const res = await admin.post('/api/todos', { data: body({ title: '見積もりを送る', due_date: today(), assignee_id: USERS.sato.id, description: '最新の単価で' }) });
    expect(res.status()).toBe(201);
    const { items, permissions, people, me } = await list(admin);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: '見積もりを送る', due_date: today(), description: '最新の単価で', done: false, overdue: false, assignee: { id: USERS.sato.id, name: '佐藤' }, created_by: '管理者' });
    expect(permissions.can_edit).toBe(true);
    expect(me).toBe(USERS.admin.id);
    expect(people.map((p: { id: string }) => p.id)).toContain(USERS.sato.id);
  });

  test('並び順: 未完了は期限の近い順（期限なしは最後）、完了したものはその後ろ', async ({ as }) => {
    const admin = await as('admin');
    const late = await make(admin, { title: 'C 期限なし' });
    await make(admin, { title: 'B 来週', due_date: addDays(today(), 7) });
    await make(admin, { title: 'A 昨日', due_date: addDays(today(), -1) });
    const done = await make(admin, { title: 'D 完了', due_date: addDays(today(), -5) });
    await admin.patch(`/api/todos/${done}`, { data: { done: true } });
    expect((await list(admin)).items.map((t: { title: string }) => t.title)).toEqual(['A 昨日', 'B 来週', 'C 期限なし', 'D 完了']);
    expect(late).toBeTruthy();
  });

  test('期限が昨日以前の未完了だけが「期限切れ」。完了すれば外れる', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin, { due_date: addDays(today(), -1) });
    await make(admin, { due_date: today() });
    const before = (await list(admin)).items;
    expect(before.map((t: { overdue: boolean }) => t.overdue)).toEqual([true, false]);
    await admin.patch(`/api/todos/${id}`, { data: { done: true } });
    expect((await list(admin)).items.every((t: { overdue: boolean }) => !t.overdue)).toBe(true);
  });

  test('完了にすると誰が完了したかが残り、戻すと消える', async ({ as }) => {
    const admin = await as('admin'), sato = await as('sato');
    const id = await make(admin);
    expect((await sato.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(200);
    const done = (await list(admin)).items[0];
    expect(done).toMatchObject({ done: true, done_by: '佐藤' });
    expect(done.done_at).toBeTruthy();
    await admin.patch(`/api/todos/${id}`, { data: { done: false } });
    expect((await list(admin)).items[0]).toMatchObject({ done: false, done_by: null, done_at: null });
  });

  test('絞り込み: 状態・担当（自分／チーム全体／特定の人）・期限の範囲', async ({ as }) => {
    const admin = await as('admin');
    await make(admin, { title: 'チーム', due_date: '2031-03-10' });
    await make(admin, { title: '自分', assignee_id: USERS.admin.id, due_date: '2031-03-20' });
    const s = await make(admin, { title: '佐藤', assignee_id: USERS.sato.id, due_date: '2031-04-02' });
    await admin.patch(`/api/todos/${s}`, { data: { done: true } });
    const titles = async (q: string) => (await list(admin, q)).items.map((t: { title: string }) => t.title).sort();
    expect(await titles('&status=open')).toEqual(['チーム', '自分']);
    expect(await titles('&status=done')).toEqual(['佐藤']);
    expect(await titles('&assignee=me')).toEqual(['自分']);
    expect(await titles('&assignee=team')).toEqual(['チーム']);
    expect(await titles(`&assignee=${USERS.sato.id}`)).toEqual(['佐藤']);
    expect(await titles('&from=2031-03-01&to=2031-03-31')).toEqual(['チーム', '自分']);
    expect(await titles('&from=2031-03-15&to=2031-03-31')).toEqual(['自分']);
    expect(await titles('&from=2031-04-02&to=2031-04-02')).toEqual(['佐藤']);
  });

  test('内容を直せる。期限・担当を外す（null）こともできる', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin, { due_date: today(), assignee_id: USERS.sato.id, description: 'メモ' });
    expect((await admin.patch(`/api/todos/${id}`, { data: { title: '直した', due_date: null, assignee_id: null, description: null } })).status()).toBe(200);
    expect((await list(admin)).items[0]).toMatchObject({ title: '直した', due_date: null, assignee: null, description: null });
  });

  test('削除できる', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin);
    expect((await admin.delete(`/api/todos/${id}`)).status()).toBe(200);
    expect((await list(admin)).items).toHaveLength(0);
    expect((await admin.delete(`/api/todos/${id}`)).status()).toBe(404);
  });

  test('入力の検査: 内容が空・長すぎる・日付が不正・担当がチームの人でない、は受け付けない', async ({ as }) => {
    const admin = await as('admin');
    for (const bad of [{ title: '  ' }, { title: 'あ'.repeat(201) }, { due_date: '2031-02-30' }, { due_date: 'あした' }, { description: 'x'.repeat(5001) }, { assignee_id: USERS.suzuki.id }]) {
      expect((await admin.post('/api/todos', { data: body(bad) })).status(), JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await admin.post('/api/todos', { data: { title: 'x' } })).status()).toBe(400);
    const id = await make(admin);
    expect((await admin.patch(`/api/todos/${id}`, { data: { assignee_id: USERS.suzuki.id } })).status()).toBe(400);
    expect((await admin.patch(`/api/todos/${id}`, { data: { title: '' } })).status()).toBe(400);
    expect((await admin.get(`/api/todos?mailboxId=${MAILBOX_ID}&from=bad`)).status()).toBe(400);
    expect((await admin.get(`/api/todos?mailboxId=${MAILBOX_ID}&status=weird`)).status()).toBe(400);
  });

  test('権限: 見るだけの人は読めるが、作成・編集・削除はできない。権限のない人は存在も分からない', async ({ as }) => {
    const admin = await as('admin'), viewer = await as('admin2'), outsider = await as('suzuki');
    const id = await make(admin, { title: '共有' });
    expect((await list(viewer)).items).toHaveLength(1);
    expect((await list(viewer)).permissions.can_edit).toBe(false);
    expect((await viewer.post('/api/todos', { data: body() })).status()).toBe(403);
    expect((await viewer.patch(`/api/todos/${id}`, { data: { title: 'x' } })).status()).toBe(403);
    expect((await viewer.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(403); // not assigned to them
    expect((await viewer.delete(`/api/todos/${id}`)).status()).toBe(403);

    expect((await outsider.get(`/api/todos?mailboxId=${MAILBOX_ID}`)).status()).toBe(403);
    expect((await outsider.post('/api/todos', { data: body() })).status()).toBe(403);
    expect((await outsider.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(404);
    expect((await outsider.delete(`/api/todos/${id}`)).status()).toBe(404);
    expect(await db.todos.count()).toBe(1);
  });

  test('見るだけの人でも、自分が担当のToDoは完了にできる（内容の編集はできない）', async ({ as }) => {
    const admin = await as('admin'), tanaka = await as('tanaka');
    const mine = await make(admin, { assignee_id: USERS.tanaka.id });
    const others = await make(admin, { assignee_id: USERS.sato.id });
    expect((await tanaka.patch(`/api/todos/${mine}`, { data: { title: '書き換え' } })).status()).toBe(403);
    expect((await tanaka.patch(`/api/todos/${mine}`, { data: { done: true, title: '書き換え' } })).status()).toBe(403);
    expect((await tanaka.patch(`/api/todos/${mine}`, { data: { done: true } })).status()).toBe(200);
    expect((await tanaka.patch(`/api/todos/${others}`, { data: { done: true } })).status()).toBe(403);
    expect(await db.todos.count({ where: { done_at: { not: null } } })).toBe(1);
  });

  test('ログインしていないと使えない', async ({ anon }) => {
    expect((await anon.get(`/api/todos?mailboxId=${MAILBOX_ID}`, { maxRedirects: 0 })).status()).not.toBe(200);
    expect((await anon.post('/api/todos', { data: body(), maxRedirects: 0 })).status()).not.toBe(201);
  });
});

test.describe('ToDoの通知（Mattermost）', () => {
  test('担当に指定すると本人にDMが届く。自分を担当にしたときは届かない', async ({ as }) => {
    const admin = await as('admin');
    await admin.post('/api/todos', { data: body({ title: '請求書を確認', due_date: '2031-05-01', assignee_id: USERS.sato.id }) });
    const [post] = await mm.waitFor(p => p.message.includes('ToDoが割り当てられました'));
    expect(post.to).toBe('mm-sato');
    expect(post.message).toContain('請求書を確認');
    expect(post.message).toContain('2031-05-01');
    expect(post.message).toContain('管理者');

    await mm.reset();
    await admin.post('/api/todos', { data: body({ assignee_id: USERS.admin.id }) });
    await admin.post('/api/todos', { data: body() }); // the whole team: nobody in particular
    await new Promise(r => setTimeout(r, 1500));
    expect(await mm.posts()).toHaveLength(0);
  });

  test('担当を付け替えたときだけ新しい担当に届く（同じ人のままなら届かない）', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin, { assignee_id: USERS.sato.id });
    await mm.waitFor(p => p.to === 'mm-sato');
    await mm.reset();
    await admin.patch(`/api/todos/${id}`, { data: { title: '名前だけ直す', assignee_id: USERS.sato.id } });
    await new Promise(r => setTimeout(r, 1500));
    expect(await mm.posts()).toHaveLength(0);
    await admin.patch(`/api/todos/${id}`, { data: { assignee_id: USERS.tanaka.id } });
    expect((await mm.waitFor(p => p.to === 'mm-tanaka'))).toHaveLength(1);
  });
});

test.describe('ToDoの画面', () => {
  test.use({ storageState: AUTH.sato });

  test('すばやく追加でき、チェックで完了・戻すができる。完了タブに移る', async ({ page }) => {
    await page.goto('/todos');
    await expect(page.getByRole('heading', { level: 1, name: 'ToDo' })).toBeVisible();
    const title = uniq('資料を印刷');
    await page.getByLabel('ToDoをすばやく追加').fill(title);
    await page.getByLabel('ToDoをすばやく追加').press('Enter');
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').click();
    await expect(row).toHaveCount(0); // 未完了のタブからは消える
    await page.getByRole('button', { name: '完了', exact: true }).click();
    const done = page.getByRole('listitem').filter({ hasText: title });
    await expect(done).toContainText('佐藤 が完了');
    await expect(done.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await done.getByRole('checkbox').click();
    await expect(done).toHaveCount(0);
  });

  test('詳細つきで追加・編集・削除ができる。期限切れは赤く出る', async ({ page }) => {
    await page.goto('/todos');
    await page.getByRole('button', { name: '＋ ToDo' }).click();
    const title = uniq('請求書の確認');
    await page.getByLabel('ToDoの内容').fill(title);
    await page.getByLabel(/期限/).fill(addDays(today(), -2));
    await page.locator('#todo-assignee').selectOption(USERS.admin.id);
    await page.getByLabel('メモ').fill('経理に確認');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toContainText('期限切れ');
    await expect(row).toContainText('担当: 管理者');
    await expect(row).toContainText('経理に確認');

    await row.getByText(title).click();
    await page.getByLabel('ToDoの内容').fill(title + '（改）');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: title + '（改）' })).toBeVisible();

    page.once('dialog', d => d.accept());
    await page.getByRole('listitem').filter({ hasText: title + '（改）' }).getByText(title + '（改）').click();
    await page.getByRole('button', { name: '削除' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(0);
  });

  test('「担当: 自分」で絞り込める', async ({ page, as }) => {
    const admin = await as('admin');
    const mine = uniq('佐藤の仕事'), other = uniq('管理者の仕事');
    await admin.post('/api/todos', { data: body({ title: mine, assignee_id: USERS.sato.id }) });
    await admin.post('/api/todos', { data: body({ title: other, assignee_id: USERS.admin.id }) });
    await page.goto('/todos');
    await expect(page.getByText(other)).toBeVisible();
    await page.getByLabel('担当で絞り込み').selectOption('me');
    await expect(page.getByText(mine)).toBeVisible();
    await expect(page.getByText(other)).toHaveCount(0);
  });

  test('メニューにToDoがある', async ({ page }) => {
    await page.goto('/threads');
    await page.locator('header').getByRole('link', { name: 'ToDo', exact: true }).click();
    await expect(page).toHaveURL(/\/todos/);
  });
});

test.describe('ToDoの画面（見るだけの人）', () => {
  test.use({ storageState: AUTH.tanaka });

  test('追加ボタンはなく、自分が担当のものだけチェックできる', async ({ page, as }) => {
    const admin = await as('admin');
    const mine = uniq('田中の仕事'), other = uniq('佐藤の仕事');
    await admin.post('/api/todos', { data: body({ title: mine, assignee_id: USERS.tanaka.id }) });
    await admin.post('/api/todos', { data: body({ title: other, assignee_id: USERS.sato.id }) });
    await page.goto('/todos');
    await expect(page.getByRole('button', { name: '＋ ToDo' })).toHaveCount(0);
    await expect(page.getByLabel('ToDoをすばやく追加')).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: mine }).getByRole('checkbox')).toBeEnabled();
    await expect(page.getByRole('listitem').filter({ hasText: other }).getByRole('checkbox')).toBeDisabled();
    await page.getByRole('listitem').filter({ hasText: mine }).getByRole('checkbox').click();
    await expect(page.getByRole('listitem').filter({ hasText: mine })).toHaveCount(0);
  });
});

test.describe('カレンダーにToDoが出る', () => {
  test.use({ storageState: AUTH.sato });
  const cells = (page: import('@playwright/test').Page) => page.locator('main .grid-cols-7').getByTestId('todo-chip');

  test('期限の日のマスに表示され、その日を選ぶと一覧からチェック・編集できる', async ({ page, as }) => {
    const admin = await as('admin');
    const title = uniq('今日が期限');
    await admin.post('/api/todos', { data: body({ title, due_date: today(), assignee_id: USERS.sato.id }) });
    await admin.post('/api/todos', { data: body({ title: '期限なしは出ない' }) });
    await page.goto('/calendar');
    await expect(cells(page).filter({ hasText: title })).toBeVisible();
    await expect(page.getByText('期限なしは出ない')).toHaveCount(0);

    const panel = page.getByLabel('この日のToDo');
    await expect(panel).toContainText(title);
    await expect(panel).toContainText('佐藤');
    await panel.getByRole('checkbox', { name: new RegExp(title) }).click();
    await expect(cells(page).filter({ hasText: title })).toContainText('☑');
    await expect.poll(() => db.todos.count({ where: { title, done_at: { not: null } } })).toBe(1);

    await panel.getByText(title).click();
    await page.getByLabel('ToDoの内容').fill(title + '（変更）');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(cells(page).filter({ hasText: title + '（変更）' })).toBeVisible();
  });

  test('カレンダーから「＋ ToDo」で、選んでいる日が期限の追加ができる', async ({ page }) => {
    await page.goto('/calendar');
    await page.getByRole('button', { name: '＋ ToDo' }).click();
    await expect(page.getByLabel(/期限/)).toHaveValue(today());
    const title = uniq('カレンダーから追加');
    await page.getByLabel('ToDoの内容').fill(title);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(cells(page).filter({ hasText: title })).toBeVisible();
    expect((await db.todos.findFirst({ where: { title } }))?.due_date?.toISOString().slice(0, 10)).toBe(today());
  });

  test('「ToDoも表示」を外すと消える。表示する人の切り替えにも従う', async ({ page, as }) => {
    const admin = await as('admin');
    const a = uniq('管理者の'), s = uniq('佐藤の');
    await admin.post('/api/todos', { data: body({ title: a, due_date: today(), assignee_id: USERS.admin.id }) });
    await admin.post('/api/todos', { data: body({ title: s, due_date: today(), assignee_id: USERS.sato.id }) });
    await page.goto('/calendar');
    const panel = page.getByLabel('この日のToDo');
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await expect(cells(page).first()).toBeVisible(); // a busy day still shows at least one to-do in its cell
    await page.getByRole('button', { name: '自分のみ' }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(panel).toContainText(s);
    await page.getByRole('button', { name: '全員' }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await page.getByLabel('ToDoも表示').uncheck();
    await expect(panel).toHaveCount(0);
    await expect(cells(page)).toHaveCount(0);
  });
});

test.describe('カレンダー（見るだけの人）', () => {
  test.use({ storageState: AUTH.tanaka });
  test('「＋ ToDo」は出ないが、ToDoは見える', async ({ page, as }) => {
    const admin = await as('admin');
    const title = uniq('見えるだけ');
    await admin.post('/api/todos', { data: body({ title, due_date: today() }) });
    await page.goto('/calendar');
    await expect(page.getByRole('button', { name: '＋ ToDo' })).toHaveCount(0);
    await expect(page.locator('main .grid-cols-7').getByTestId('todo-chip').filter({ hasText: title })).toBeVisible();
  });
});
