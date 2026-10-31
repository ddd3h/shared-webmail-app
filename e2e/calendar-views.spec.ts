import { test, expect, uniq } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { seedCalendar, todayAt } from './helpers/seed';
import { addDays, today } from './helpers/ui';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await seedCalendar(); await db.todos.deleteMany({}); });
test.afterAll(async () => { await seedCalendar(); await db.todos.deleteMany({}); });

type Page = import('@playwright/test').Page;
const switcher = (page: Page) => page.getByRole('group', { name: '表示の切り替え' });
const view = (page: Page, label: '日' | '週' | '月') => switcher(page).getByRole('button', { name: label, exact: true });
const title = (page: Page) => page.locator('[aria-live=polite]');
const grid = (page: Page) => page.getByTestId('time-grid');
const columns = (page: Page) => page.getByTestId('day-column');
const eventsOf = (page: Page, text: string) => page.getByTestId('grid-event').filter({ hasText: text });
const open = async (page: Page, query = '') => { await page.goto(`/calendar${query}`); await expect(page.getByRole('heading', { level: 1, name: 'カレンダー' })).toBeVisible(); };
const jp = (ymd: string) => { const d = new Date(`${ymd}T00:00:00`); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`; };

test.describe('日・週・月の切り替え（管理者）', () => {
  test.use({ storageState: AUTH.admin });

  test('はじめは月表示。日・週・月のボタンがあり、いま開いているものが分かる', async ({ page }) => {
    await open(page);
    for (const l of ['日', '週', '月'] as const) await expect(view(page, l)).toBeVisible();
    await expect(view(page, '月')).toHaveAttribute('aria-pressed', 'true');
    await expect(view(page, '週')).toHaveAttribute('aria-pressed', 'false');
    await expect(grid(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '前の月' })).toBeVisible();
  });

  test('週: 日曜はじまりの7日が並び、今日の予定が時間の位置に出る', async ({ page }) => {
    await open(page);
    await view(page, '週').click();
    await expect(grid(page)).toBeVisible();
    await expect(columns(page)).toHaveCount(7);
    await expect(page.getByRole('button', { name: '前の週' })).toBeVisible();
    await expect(page.getByRole('button', { name: '次の週' })).toBeVisible();
    const col = page.locator(`[data-testid=day-column][data-date="${today()}"]`);
    const meeting = col.getByTestId('grid-event').filter({ hasText: '週次ミーティング' });
    await expect(meeting).toBeVisible();
    // 10:00-11:00 sits 10 hours down (48px an hour) and is one hour tall
    const box = (await meeting.boundingBox())!, colBox = (await col.boundingBox())!;
    expect(Math.round(box.y - colBox.y)).toBeGreaterThanOrEqual(478);
    expect(Math.round(box.y - colBox.y)).toBeLessThanOrEqual(482);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeLessThanOrEqual(48);
    await expect(meeting).toContainText('10:00–11:00');
  });

  test('週の見出しは日曜〜土曜。月をまたぐ週も正しい。前へ・次へは7日ずつ', async ({ page }) => {
    await open(page, '?view=week&date=2026-10-29');
    await expect(title(page)).toHaveText('2026年10月25日 – 31日');
    await page.getByRole('button', { name: '次の週' }).click();
    await expect(title(page)).toHaveText('2026年11月1日 – 7日');
    await page.getByRole('button', { name: '前の週' }).click();
    await page.getByRole('button', { name: '前の週' }).click();
    await expect(title(page)).toHaveText('2026年10月18日 – 24日');
    await open(page, '?view=week&date=2026-09-30');
    await expect(title(page)).toHaveText('2026年9月27日 – 10月3日');
    await expect(page).toHaveURL(/view=week&date=2026-09-30/);
  });

  test('日: 1日だけの列。前の日・次の日で1日ずつ動き、「今日」で戻る', async ({ page }) => {
    await open(page, `?view=day&date=${today()}`);
    await expect(columns(page)).toHaveCount(1);
    await expect(title(page)).toHaveText(jp(today()));
    await expect(eventsOf(page, '週次ミーティング')).toBeVisible();
    await page.getByRole('button', { name: '次の日' }).click();
    await expect(title(page)).toHaveText(jp(addDays(today(), 1)));
    await expect(eventsOf(page, '週次ミーティング')).toHaveCount(0);
    await page.getByRole('button', { name: '前の日' }).click();
    await page.getByRole('button', { name: '前の日' }).click();
    await expect(title(page)).toHaveText(jp(addDays(today(), -1)));
    await page.getByRole('button', { name: '今日' }).click();
    await expect(title(page)).toHaveText(jp(today()));
  });

  test('切り替えても、見ている日が変わらない（月で選んだ日 → 日 → 週 → 月）', async ({ page }) => {
    await open(page);
    // a day of this month (a day of the neighbouring month shown in the grid opens the 1st instead)
    const target = addDays(today(), addDays(today(), 1).slice(0, 7) === today().slice(0, 7) ? 1 : -1);
    await page.locator(`main .grid-cols-7 button[data-date="${target}"]`).click();
    await view(page, '日').click();
    await expect(title(page)).toHaveText(jp(target));
    await view(page, '週').click();
    await expect(page.locator(`[data-testid=day-column][data-date="${target}"]`)).toBeVisible();
    await view(page, '月').click();
    await expect(title(page)).toHaveText(`${target.slice(0, 4)}年${Number(target.slice(5, 7))}月`);
    await expect(page.locator('main .grid-cols-7 button[data-date]').first()).toBeVisible();
  });

  test('週の見出しの日をクリックすると、その日の「日」表示になる', async ({ page }) => {
    await open(page, `?view=week&date=${today()}`);
    await page.getByRole('button', { name: new RegExp(`^${Number(today().slice(5, 7))}月${Number(today().slice(8))}日.*を開く`) }).click();
    await expect(view(page, '日')).toHaveAttribute('aria-pressed', 'true');
    await expect(title(page)).toHaveText(jp(today()));
  });

  test('開いている表示と日付はアドレスに入り、再読み込みしても同じ。次に開いたときは前回の表示になる', async ({ page }) => {
    await open(page);
    await view(page, '週').click();
    await expect(page).toHaveURL(/view=week&date=\d{4}-\d{2}-\d{2}/);
    await page.reload();
    await expect(view(page, '週')).toHaveAttribute('aria-pressed', 'true');
    await expect(columns(page)).toHaveCount(7);
    await page.goto('/calendar'); // no address hints: the last choice comes back
    await expect(view(page, '週')).toHaveAttribute('aria-pressed', 'true');
    await view(page, '月').click();
    await page.goto('/calendar');
    await expect(view(page, '月')).toHaveAttribute('aria-pressed', 'true');
  });

  test('重なる予定は横に並ぶ（幅が分かれる）。重ならない予定は幅いっぱい', async ({ page }) => {
    await db.calendar_events.createMany({ data: [
      { id: 'ev_o1', source: 'local', title: '重なりA', start_at: todayAt('18:00'), end_at: todayAt('19:00'), created_by_id: USERS.admin.id, owner_user_id: USERS.admin.id },
      { id: 'ev_o2', source: 'local', title: '重なりB', start_at: todayAt('18:30'), end_at: todayAt('19:30'), created_by_id: USERS.admin.id, owner_user_id: USERS.admin.id },
    ] });
    await open(page, `?view=day&date=${today()}`);
    const col = (await columns(page).first().boundingBox())!;
    const a = (await eventsOf(page, '重なりA').boundingBox())!, b = (await eventsOf(page, '重なりB').boundingBox())!;
    expect(a.width).toBeLessThan(col.width * 0.6);
    expect(b.width).toBeLessThan(col.width * 0.6);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(col.width * 0.4); // side by side, not on top of each other
    const solo = (await eventsOf(page, '週次ミーティング').boundingBox())!;
    expect(solo.width).toBeGreaterThan(col.width * 0.9);
  });

  test('終日の予定とToDoは、時間の枠ではなく上の「終日」の行に出る', async ({ page }) => {
    const start = new Date(`${today()}T00:00:00Z`);
    await db.calendar_events.create({ data: { id: 'ev_allday', owner_user_id: USERS.admin.id, source: 'local', title: '終日の出張', all_day: true, start_at: start, end_at: new Date(start.getTime() + 86400_000), created_by_id: USERS.admin.id } });
    const todo = uniq('期限が今日');
    await db.todos.create({ data: { title: todo, due_date: new Date(`${today()}T00:00:00Z`), assignee_id: USERS.admin.id } });
    await open(page, `?view=week&date=${today()}`);
    const row = page.getByLabel('終日の予定とToDo');
    await expect(row.getByTestId('grid-allday').filter({ hasText: '終日の出張' })).toBeVisible();
    await expect(row.getByTestId('todo-chip').filter({ hasText: todo })).toBeVisible();
    await expect(page.getByTestId('grid-event').filter({ hasText: '終日の出張' })).toHaveCount(0);
    // the check box of the to-do still works from here (click opens it)
    await row.getByTestId('todo-chip').filter({ hasText: todo }).click();
    await expect(page.getByRole('dialog', { name: 'ToDoを編集' })).toBeVisible();
  });

  test('予定をクリックすると編集ができ、変えるとその場で位置が変わる', async ({ page }) => {
    await open(page, `?view=day&date=${today()}`);
    await eventsOf(page, '週次ミーティング').click();
    await expect(page.getByRole('dialog', { name: '予定を編集' })).toBeVisible();
    await page.getByPlaceholder('タイトル').fill('週次ミーティング（変更）');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(eventsOf(page, '週次ミーティング（変更）')).toBeVisible();
  });

  test('空いている時間をクリックすると、その時刻から1時間の予定を作れる', async ({ page }) => {
    await open(page, `?view=day&date=${today()}`);
    await expect(eventsOf(page, '週次ミーティング')).toBeVisible(); // the page knows what this person may do once its data has arrived
    const col = columns(page).first();
    await col.click({ position: { x: 8, y: 9 * 48 + 10 } }); // a little below 9:00
    await expect(page.getByRole('dialog', { name: '予定を追加' })).toBeVisible();
    await expect(page.getByLabel('開始')).toHaveValue(`${today()}T09:00`);
    await expect(page.getByLabel('終了')).toHaveValue(`${today()}T10:00`);
    const name = uniq('枠から作成');
    await page.getByPlaceholder('タイトル').fill(name);
    await page.getByRole('button', { name: '保存' }).click();
    const created = eventsOf(page, name);
    await expect(created).toBeVisible();
    const row = await db.calendar_events.findFirst({ where: { title: name } });
    expect(row).toBeTruthy();
    expect((await created.boundingBox())!.y - (await col.boundingBox())!.y).toBeGreaterThan(9 * 48 - 3);
  });

  test('「表示する人」の切り替えは、日・週にも効く（共有メールのメンバーのカレンダーで）', async ({ page }) => {
    await open(page, `?mailbox=mb_team&view=day&date=${today()}`);
    await expect(eventsOf(page, '週次ミーティング')).toBeVisible();
    await expect(eventsOf(page, '社内MTG')).toBeVisible();
    await page.getByRole('button', { name: '自分のみ' }).click();
    await expect(eventsOf(page, '社内MTG')).toHaveCount(0);
    await expect(eventsOf(page, '週次ミーティング')).toBeVisible(); // my own event stays
    await page.getByRole('button', { name: '全員' }).click();
    await expect(eventsOf(page, '社内MTG')).toBeVisible();
  });
});

test.describe('日・週・月（副管理者）', () => {
  test.use({ storageState: AUTH.admin2 });
  test('時間の枠をクリックすると、自分のカレンダーの予定が作れる。自分の予定だけが出る', async ({ page }) => {
    await open(page, `?view=day&date=${today()}`);
    await expect(eventsOf(page, '全体会議')).toBeVisible();
    await expect(eventsOf(page, '週次ミーティング')).toHaveCount(0); // not a party to it
    await columns(page).first().click({ position: { x: 8, y: 9 * 48 + 10 } });
    await expect(page.getByRole('dialog', { name: '予定を追加' })).toBeVisible();
  });
});
