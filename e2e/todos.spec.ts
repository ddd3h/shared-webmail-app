import { test, expect, uniq } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications } from './helpers/seed';
import { addDays, today } from './helpers/ui';

// ToDoは、個人に1つ。共有メールは「そのメンバーのToDoを見る」入口。
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await db.todos.deleteMany({}); await clearNotifications(); await mm.reset(); });
test.afterAll(async () => { await db.todos.deleteMany({}); await mm.reset(); });

type Api = import('@playwright/test').APIRequestContext;
const body = (o: object = {}) => ({ title: uniq('ToDo'), ...o });
const mine = async (c: Api, q = '') => (await (await c.get(`/api/todos?x=1${q}`)).json());
const team = async (c: Api, q = '') => (await (await c.get(`/api/todos?mailboxId=${MAILBOX_ID}${q}`)).json());
const make = async (c: Api, o: object = {}) => (await (await c.post('/api/todos', { data: body(o) })).json()).id as string;
const titlesOf = (r: { items: { title: string }[] }) => r.items.map(t => t.title);

// admin, sato = members of the team mailbox; admin2, tanaka = members too (view only on the mailbox); suzuki = not a member
test.describe('ToDoのAPI（自分のToDo）', () => {
  test('作ると、自分のリストに入る。期限・メモも保存される。自分のリストには自分の分だけ', async ({ as }) => {
    const admin = await as('admin');
    expect((await admin.post('/api/todos', { data: body({ title: '見積もりを送る', due_date: today(), description: '最新の単価で' }) })).status()).toBe(201);
    await make(await as('sato'), { title: '佐藤の仕事' });
    const { items, people, assignable, me } = await mine(admin);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: '見積もりを送る', due_date: today(), description: '最新の単価で', done: false, overdue: false, assignee: { id: USERS.admin.id, name: '管理者' }, created_by: '管理者', can_edit: true });
    expect(me).toBe(USERS.admin.id);
    expect(people).toEqual([{ id: USERS.admin.id, name: '管理者' }]);
    expect(assignable.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([USERS.admin.id, USERS.sato.id, USERS.tanaka.id]));
    expect(assignable.map((p: { id: string }) => p.id)).not.toContain(USERS.suzuki.id); // not in a team with admin
  });

  test('並び順: 未完了は期限の近い順（期限なしは最後）、完了したものはその後ろ', async ({ as }) => {
    const admin = await as('admin');
    await make(admin, { title: 'C 期限なし' });
    await make(admin, { title: 'B 来週', due_date: addDays(today(), 7) });
    await make(admin, { title: 'A 昨日', due_date: addDays(today(), -1) });
    const done = await make(admin, { title: 'D 完了', due_date: addDays(today(), -5) });
    await admin.patch(`/api/todos/${done}`, { data: { done: true } });
    expect(titlesOf(await mine(admin))).toEqual(['A 昨日', 'B 来週', 'C 期限なし', 'D 完了']);
  });

  test('期限が昨日以前の未完了だけが「期限切れ」。完了すれば外れる', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin, { due_date: addDays(today(), -1) });
    await make(admin, { due_date: today() });
    expect((await mine(admin)).items.map((t: { overdue: boolean }) => t.overdue)).toEqual([true, false]);
    await admin.patch(`/api/todos/${id}`, { data: { done: true } });
    expect((await mine(admin)).items.every((t: { overdue: boolean }) => !t.overdue)).toBe(true);
  });

  test('完了にすると誰が完了したかが残り、戻すと消える', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin);
    expect((await admin.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(200);
    const done = (await mine(admin)).items[0];
    expect(done).toMatchObject({ done: true, done_by: '管理者' });
    expect(done.done_at).toBeTruthy();
    await admin.patch(`/api/todos/${id}`, { data: { done: false } });
    expect((await mine(admin)).items[0]).toMatchObject({ done: false, done_by: null, done_at: null });
  });

  test('絞り込み: 状態・期限の範囲', async ({ as }) => {
    const admin = await as('admin');
    await make(admin, { title: '三月の前半', due_date: '2031-03-10' });
    await make(admin, { title: '三月の後半', due_date: '2031-03-20' });
    const s = await make(admin, { title: '四月', due_date: '2031-04-02' });
    await admin.patch(`/api/todos/${s}`, { data: { done: true } });
    const titles = async (q: string) => titlesOf(await mine(admin, q)).sort();
    expect(await titles('&status=open')).toEqual(['三月の前半', '三月の後半'].sort());
    expect(await titles('&status=done')).toEqual(['四月']);
    expect(await titles('&from=2031-03-01&to=2031-03-31')).toEqual(['三月の前半', '三月の後半'].sort());
    expect(await titles('&from=2031-03-15&to=2031-03-31')).toEqual(['三月の後半']);
    expect(await titles('&from=2031-04-02&to=2031-04-02')).toEqual(['四月']);
  });

  test('内容と期限を直せる。期限を外す（null）こともできる', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin, { due_date: today(), description: 'メモ' });
    expect((await admin.patch(`/api/todos/${id}`, { data: { title: '直した', due_date: null, description: null } })).status()).toBe(200);
    expect((await mine(admin)).items[0]).toMatchObject({ title: '直した', due_date: null, description: null });
  });

  test('削除できる', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin);
    expect((await admin.delete(`/api/todos/${id}`)).status()).toBe(200);
    expect((await mine(admin)).items).toHaveLength(0);
    expect((await admin.delete(`/api/todos/${id}`)).status()).toBe(404);
  });

  test('入力の検査: 内容が空・長すぎる・日付が不正は受け付けない。チーム全体（担当なし）のToDoはもうない', async ({ as }) => {
    const admin = await as('admin');
    for (const bad of [{ title: '  ' }, { title: 'あ'.repeat(201) }, { due_date: '2031-02-30' }, { due_date: 'あした' }, { description: 'x'.repeat(5001) }, { assignee_id: null }, { assignee_id: '' }]) {
      expect((await admin.post('/api/todos', { data: body(bad) })).status(), JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await admin.post('/api/todos', { data: {} })).status()).toBe(400);
    const id = await make(admin);
    expect((await admin.patch(`/api/todos/${id}`, { data: { title: '' } })).status()).toBe(400);
    expect((await admin.get('/api/todos?from=bad')).status()).toBe(400);
    expect((await admin.get('/api/todos?status=weird')).status()).toBe(400);
  });

  test('ログインしていないと使えない', async ({ anon }) => {
    expect((await anon.get('/api/todos', { maxRedirects: 0 })).status()).not.toBe(200);
    expect((await anon.post('/api/todos', { data: body(), maxRedirects: 0 })).status()).not.toBe(201);
  });
});

test.describe('ToDoのAPI（ほかの人のToDo）', () => {
  test('共有メールを選ぶと、メンバー全員のToDoが見える。メンバーでない人は403。メンバーでない人のToDoは見えない', async ({ as }) => {
    await make(await as('admin'), { title: '管理者の' });
    await make(await as('sato'), { title: '佐藤の' });
    await make(await as('suzuki'), { title: '鈴木の' });
    const r = await team(await as('tanaka'));
    expect(titlesOf(r).sort()).toEqual(['管理者の', '佐藤の'].sort());
    expect(r.people.map((p: { id: string }) => p.id).sort()).toEqual([USERS.admin.id, USERS.admin2.id, USERS.sato.id, USERS.tanaka.id].sort());
    expect((await (await as('suzuki')).get(`/api/todos?mailboxId=${MAILBOX_ID}`)).status()).toBe(403);
    expect(titlesOf(await mine(await as('suzuki')))).toEqual(['鈴木の']);
  });

  test('担当で絞り込める（自分／メンバーの1人）。メンバーでない人を指定すると400', async ({ as }) => {
    await make(await as('admin'), { title: '管理者の' });
    await make(await as('sato'), { title: '佐藤の' });
    const tanaka = await as('tanaka');
    expect(titlesOf(await team(tanaka, `&assignee=${USERS.sato.id}`))).toEqual(['佐藤の']);
    expect(titlesOf(await team(tanaka, '&assignee=me'))).toEqual([]);
    expect((await tanaka.get(`/api/todos?mailboxId=${MAILBOX_ID}&assignee=${USERS.suzuki.id}`)).status()).toBe(400);
  });

  test('同じ共有メールのメンバーのリストに、ToDoを入れられる（入れた人も変えられる）。ほかの人のリストには入れられない', async ({ as }) => {
    const admin = await as('admin');
    const id = await make(admin, { title: '佐藤さんにお願い', assignee_id: USERS.sato.id });
    expect(titlesOf(await mine(await as('sato')))).toEqual(['佐藤さんにお願い']);
    expect(titlesOf(await mine(admin))).toEqual([]); // it is on sato's list, not on mine
    const item = (await mine(await as('sato'))).items[0];
    expect(item).toMatchObject({ assignee: { id: USERS.sato.id }, created_by: '管理者', can_edit: true });
    expect((await admin.patch(`/api/todos/${id}`, { data: { title: '入れた人が直す' } })).status()).toBe(200);
    expect((await admin.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(200);
    expect((await admin.post('/api/todos', { data: body({ assignee_id: USERS.suzuki.id }) })).status()).toBe(400); // not in a team together
    expect((await admin.post('/api/todos', { data: body({ assignee_id: 'u_nobody' }) })).status()).toBe(400);
    const other = await make(admin);
    expect((await admin.patch(`/api/todos/${other}`, { data: { assignee_id: USERS.suzuki.id } })).status()).toBe(400);
  });

  test('権限: 見るだけの人（メンバー）は、ほかの人のToDoを読めるが、変更・完了・削除はできない。無関係な人には存在も分からない', async ({ as }) => {
    const id = await make(await as('admin'), { title: '管理者の' });
    const viewer = await as('tanaka'), outsider = await as('suzuki');
    expect(titlesOf(await team(viewer))).toEqual(['管理者の']);
    expect((await team(viewer)).items[0].can_edit).toBe(false);
    expect((await viewer.patch(`/api/todos/${id}`, { data: { title: 'x' } })).status()).toBe(403);
    expect((await viewer.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(403);
    expect((await viewer.delete(`/api/todos/${id}`)).status()).toBe(403);
    expect((await outsider.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(404);
    expect((await outsider.delete(`/api/todos/${id}`)).status()).toBe(403);
    expect(await db.todos.count()).toBe(1);
    expect(await db.todos.count({ where: { done_at: { not: null } } })).toBe(0);
  });

  test('自分のリストのToDoは、誰が入れたものでも、自分で完了・編集・削除できる', async ({ as }) => {
    const id = await make(await as('admin'), { assignee_id: USERS.tanaka.id });
    const tanaka = await as('tanaka');
    expect((await tanaka.patch(`/api/todos/${id}`, { data: { done: true } })).status()).toBe(200);
    expect((await tanaka.patch(`/api/todos/${id}`, { data: { title: '自分で直した' } })).status()).toBe(200);
    expect((await tanaka.delete(`/api/todos/${id}`)).status()).toBe(200);
  });
});

test.describe('ToDoの通知（Mattermost）', () => {
  test('ほかの人のリストに入れると、本人にDMが届く。自分のリストに入れたときは届かない', async ({ as }) => {
    const admin = await as('admin');
    await admin.post('/api/todos', { data: body({ title: '請求書を確認', due_date: '2031-05-01', assignee_id: USERS.sato.id }) });
    const [post] = await mm.waitFor(p => p.message.includes('ToDoが追加されました'));
    expect(post.to).toBe('mm-sato');
    expect(post.message).toContain('請求書を確認');
    expect(post.message).toContain('2031-05-01');
    expect(post.message).toContain('管理者');

    await mm.reset();
    await admin.post('/api/todos', { data: body({ assignee_id: USERS.admin.id }) });
    await admin.post('/api/todos', { data: body() }); // my own
    await new Promise(r => setTimeout(r, 1500));
    expect(await mm.posts()).toHaveLength(0);
  });

  test('リストを付け替えたときだけ新しい持ち主に届く（同じ人のままなら届かない）', async ({ as }) => {
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

  test('詳細つきで追加・編集・削除ができる。期限切れは赤く出る。ほかの人のリストにも入れられる', async ({ page }) => {
    await page.goto('/todos');
    await page.getByRole('button', { name: '＋ ToDo' }).click();
    const title = uniq('請求書の確認');
    await page.getByLabel('ToDoの内容').fill(title);
    await page.getByLabel(/期限/).fill(addDays(today(), -2));
    await page.getByLabel('メモ').fill('経理に確認');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toContainText('期限切れ');
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

  test('「誰のToDo」を選ぶと、その人のリストに入る（自分のリストには出ない）', async ({ page }) => {
    await page.goto('/todos');
    await page.getByRole('button', { name: '＋ ToDo' }).click();
    const title = uniq('管理者さんへ');
    await page.getByLabel('ToDoの内容').fill(title);
    await page.locator('#todo-assignee').selectOption(USERS.admin.id);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect(page.getByText(title)).toHaveCount(0);
    expect((await db.todos.findFirstOrThrow({ where: { title } })).assignee_id).toBe(USERS.admin.id);
  });

  test('共有メールを選ぶと、メンバーのToDoが見える。「担当: 自分」で絞り込める。メンバーのものは編集できない', async ({ page, as }) => {
    const admin = await as('admin');
    const a = uniq('管理者の仕事'), s = uniq('佐藤の仕事');
    await admin.post('/api/todos', { data: body({ title: a }) });
    await make(await as('sato'), { title: s });
    await page.goto('/todos');
    await expect(page.getByText(a)).toHaveCount(0);   // my own list first
    await expect(page.getByText(s)).toBeVisible();
    await page.getByLabel('見るToDo').selectOption({ label: '営業チーム共有 のメンバー' });
    await expect(page.getByText(a)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: a }).getByRole('checkbox')).toBeDisabled();
    await expect(page.getByRole('listitem').filter({ hasText: s }).getByRole('checkbox')).toBeEnabled();
    await page.getByLabel('担当で絞り込み').selectOption('me');
    await expect(page.getByText(s)).toBeVisible();
    await expect(page.getByText(a)).toHaveCount(0);
  });

  test('メニューにToDoがある', async ({ page }) => {
    await page.goto('/threads');
    await page.locator('header').getByRole('link', { name: 'ToDo', exact: true }).click();
    await expect(page).toHaveURL(/\/todos/);
  });
});

test.describe('ToDoの画面（共有メールのメンバーでない人）', () => {
  test.use({ storageState: AUTH.suzuki });
  test('自分のToDoだけ。共有メールを選ぶ欄はない', async ({ page }) => {
    await page.goto('/todos');
    await expect(page.getByLabel('ToDoをすばやく追加')).toBeVisible();
    await expect(page.getByLabel('見るToDo')).toHaveCount(0);
  });
});

test.describe('カレンダーにToDoが出る', () => {
  test.use({ storageState: AUTH.sato });
  const cells = (page: import('@playwright/test').Page) => page.locator('main .grid-cols-7').getByTestId('todo-chip');

  test('期限の日のマスに表示され、その日を選ぶと一覧からチェック・編集できる。期限なしは出ない', async ({ page }) => {
    const sato = await db.users.findFirstOrThrow({ where: { id: USERS.sato.id } });
    const title = uniq('今日が期限');
    await db.todos.create({ data: { title, due_date: new Date(`${today()}T00:00:00Z`), assignee_id: sato.id, created_by_id: sato.id } });
    await db.todos.create({ data: { title: '期限なしは出ない', assignee_id: sato.id, created_by_id: sato.id } });
    await page.goto('/calendar');
    await expect(cells(page).filter({ hasText: title })).toBeVisible();
    await expect(page.getByText('期限なしは出ない')).toHaveCount(0);

    const panel = page.getByLabel('この日のToDo');
    await expect(panel).toContainText(title);
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

  test('自分のカレンダーには自分のToDoだけ。共有メールのメンバーのカレンダーでは、メンバーのToDoも出て、人の切り替えに従う。「ToDoも表示」を外すと消える', async ({ page, as }) => {
    const a = uniq('管理者の'), s = uniq('佐藤の');
    await (await as('admin')).post('/api/todos', { data: body({ title: a, due_date: today() }) });
    await (await as('sato')).post('/api/todos', { data: body({ title: s, due_date: today() }) });
    await page.goto('/calendar');
    const panel = page.getByLabel('この日のToDo');
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(panel).toContainText(s);
    await page.getByLabel('見るカレンダー').selectOption({ label: '営業チーム共有 のメンバー' });
    await expect(panel.getByRole('listitem')).toHaveCount(2);
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
