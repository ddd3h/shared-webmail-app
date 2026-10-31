import { test, expect, uniq } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { clearNotifications, seedCalendar, todayAt } from './helpers/seed';
import { addDays, today } from './helpers/ui';

// カレンダーは、個人に1つ。共有メールは「そのメンバーのカレンダーを見る」入口。
// 予定は、持ち主（作った人）と参加者のカレンダーに入る。
test.beforeEach(async () => { await seedCalendar(); await clearNotifications(); });

const range = () => `from=${encodeURIComponent(new Date(Date.now() - 40 * 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 40 * 86400_000).toISOString())}`;
const mineUrl = `/api/calendar/events?${range()}`;
const teamUrl = `/api/calendar/events?mailboxId=${MAILBOX_ID}&${range()}`;
const aside = (page: import('@playwright/test').Page) => page.locator('aside');
type Page = import('@playwright/test').Page;

async function openCalendar(page: Page, wait = '週次ミーティング') {
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { level: 1, name: 'カレンダー' })).toBeVisible();
  if (wait) await expect(aside(page)).toContainText(wait);
}
/** Look at the calendars of the people of the shared mailbox. */
async function openTeam(page: Page) {
  await page.goto('/calendar');
  await page.getByLabel('見るカレンダー').selectOption({ label: '営業チーム共有 のメンバー' });
  await expect(aside(page)).toContainText('週次ミーティング');
}
const titles = async (res: import('@playwright/test').APIResponse) => (await res.json()).items.map((i: { title: string }) => i.title).sort();

test.describe('自分のカレンダー', () => {
  test.describe('管理者', () => {
    test.use({ storageState: AUTH.admin });

    test('自分の予定だけが出る（ほかの人のGoogleの予定は出ない）。月表示にも出る', async ({ page }) => {
      await openCalendar(page);
      await expect(aside(page).getByText('週次ミーティング')).toBeVisible();
      await expect(page.locator('main .grid-cols-7 button', { hasText: '週次ミーティング' })).toBeVisible();
      await expect(aside(page)).not.toContainText('全体会議');
      await expect(aside(page)).not.toContainText('社内MTG');
    });

    test('予定の一覧には、持ち主と参加者の人数が出る', async ({ page }) => {
      await openCalendar(page);
      await expect(aside(page).getByRole('button', { name: /週次ミーティング/ })).toContainText('管理者 ほか2人');
    });

    test('「見るカレンダー」に、自分のカレンダーと、共有メールのメンバーが並ぶ', async ({ page }) => {
      await openCalendar(page);
      const select = page.getByLabel('見るカレンダー');
      await expect(select).toContainText('自分のカレンダー');
      await expect(select).toContainText('営業チーム共有 のメンバー');
    });

    test('前の月・次の月・今日に移動できる', async ({ page }) => {
      await openCalendar(page);
      const label = page.locator('main').getByText(/\d{4}年\d{1,2}月/).first();
      const first = await label.textContent();
      await page.getByRole('button', { name: '次の月' }).click();
      await expect(label).not.toHaveText(first!);
      await expect(page.locator('main .grid-cols-7 button', { hasText: '週次ミーティング' })).toHaveCount(0);
      await page.getByRole('button', { name: '今日' }).click();
      await expect(label).toHaveText(first!);
      await expect(page.locator('main .grid-cols-7 button', { hasText: '週次ミーティング' })).toBeVisible();
    });

    test('日付をクリックするとその日の予定一覧に切り替わる', async ({ page }) => {
      await openCalendar(page);
      await page.locator('main .grid-cols-7 button').filter({ hasNotText: '週次ミーティング' }).filter({ hasText: /^\d+$/ }).first().click();
      await expect(aside(page)).toContainText('予定はありません');
    });
  });

  test.describe('参加者（佐藤）', () => {
    test.use({ storageState: AUTH.sato });
    test('自分が参加する予定が、自分のカレンダーに入る。自分のGoogleの予定も', async ({ page }) => {
      await openCalendar(page);
      await expect(aside(page).getByRole('button', { name: /週次ミーティング/ })).toContainText('管理者');
      await expect(aside(page).getByRole('button', { name: /社内MTG/ })).toBeVisible();
      await expect(aside(page).getByText('予定あり', { exact: true })).toBeVisible();
      await expect(aside(page)).not.toContainText('全体会議'); // 副管理者のGoogleの予定は、自分のカレンダーにはない
    });
  });

  test.describe('参加していない人（鈴木）', () => {
    test.use({ storageState: AUTH.suzuki });
    test('その予定は自分のカレンダーに出ない。共有メールを選ぶ欄もない', async ({ page }) => {
      await page.goto('/calendar');
      await expect(page.getByRole('heading', { level: 1, name: 'カレンダー' })).toBeVisible();
      await expect(aside(page)).toContainText('予定はありません');
      await expect(page.getByLabel('見るカレンダー')).toHaveCount(0);
    });
  });
});

test.describe('共有メールのメンバーのカレンダー', () => {
  test.use({ storageState: AUTH.admin });

  test('共有メールを選ぶと、メンバー全員の予定が見える', async ({ page }) => {
    await openTeam(page);
    for (const t of ['週次ミーティング', '社内MTG', '全体会議']) await expect(aside(page).getByRole('button', { name: new RegExp(t) })).toBeVisible();
    await expect(aside(page).getByText('予定あり', { exact: true })).toBeVisible();
  });

  test('「予定ありのみ」の連携予定は「予定あり」とだけ表示される。こちらで付けた名前は「名称変更済」', async ({ page }) => {
    await openTeam(page);
    await expect(aside(page).getByText('予定あり', { exact: true })).toBeVisible();
    await expect(page.getByText('原本タイトル')).toHaveCount(0);
    await expect(aside(page).getByRole('button', { name: /社内MTG/ })).toContainText('名称変更済');
  });

  test('詳細表示の連携予定はタイトルと場所が見える。誰の予定かも出る', async ({ page }) => {
    await openTeam(page);
    await expect(aside(page).getByRole('button', { name: /全体会議/ })).toContainText('大会議室');
    await expect(aside(page).getByRole('button', { name: /全体会議/ })).toContainText('副管理者');
    await expect(aside(page).getByRole('button', { name: /社内MTG/ })).toContainText('佐藤');
  });

  test('表示する人のチップに、メンバー全員が並ぶ。「自分のみ」で自分と参加している予定だけになり、「全員」で戻る', async ({ page }) => {
    await openTeam(page);
    for (const n of ['管理者（自分）', '副管理者', '佐藤', '田中']) await expect(page.getByRole('button', { name: new RegExp(n) }).first()).toBeVisible();
    await page.getByRole('button', { name: '自分のみ' }).click();
    await expect(aside(page)).toContainText('週次ミーティング');
    await expect(aside(page)).not.toContainText('全体会議');
    await expect(aside(page)).not.toContainText('社内MTG');
    await page.getByRole('button', { name: '全員' }).click();
    await expect(aside(page)).toContainText('全体会議');
  });

  test('人のチップを1つ切ると、その人の予定だけ消える（その人が参加する予定も）', async ({ page }) => {
    await openTeam(page);
    await page.getByRole('button', { name: '副管理者' }).first().click();
    await expect(aside(page)).not.toContainText('全体会議');
    await expect(aside(page)).toContainText('社内MTG');
    await page.getByRole('button', { name: '全員' }).click();
    await expect(aside(page)).toContainText('全体会議');
  });

  test('参加者が複数のメンバーでも、予定は1件だけ出る', async ({ page }) => {
    await openTeam(page);
    await expect(aside(page).getByRole('button', { name: /週次ミーティング/ })).toHaveCount(1);
  });
});

test.describe('予定の作成・編集・削除', () => {
  test.use({ storageState: AUTH.admin });

  test('タイトルと場所を入れて予定を追加できる。自分のカレンダーの予定になる', async ({ page }) => {
    const title = uniq('営業会議');
    await openCalendar(page);
    await page.getByRole('button', { name: '＋ 予定' }).first().click();
    await page.getByPlaceholder('タイトル').fill(title);
    await page.getByPlaceholder('場所').fill('会議室B');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect(aside(page).getByRole('button', { name: new RegExp(title) })).toContainText('会議室B');
    const row = await db.calendar_events.findFirst({ where: { title }, include: { attendees: true } });
    expect(row).toMatchObject({ source: 'local', owner_user_id: USERS.admin.id, created_by_id: USERS.admin.id, location: '会議室B' });
    expect(row!.attendees).toEqual([]);
  });

  test('社内の人を参加者に選ぶと、その人のカレンダーにも入る（招待の通知も届く）', async ({ page, as }) => {
    const title = uniq('合同レビュー');
    await openCalendar(page);
    await page.getByRole('button', { name: '＋ 予定' }).first().click();
    await page.getByPlaceholder('タイトル').fill(title);
    await page.locator('#event-attendee').selectOption({ label: '鈴木' });
    await page.locator('#event-attendee').selectOption({ label: '田中' });
    await expect(page.getByTestId('attendees')).toContainText('鈴木');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(aside(page).getByRole('button', { name: new RegExp(title) })).toContainText('管理者 ほか2人');
    const row = await db.calendar_events.findFirstOrThrow({ where: { title }, include: { attendees: true } });
    expect(row.attendees.map(a => a.user_id).sort()).toEqual([USERS.suzuki.id, USERS.tanaka.id].sort());
    // it is in their own calendars now (suzuki is in no team with admin: that does not matter)
    for (const who of ['suzuki', 'tanaka'] as const) expect(await titles(await (await as(who)).get(mineUrl))).toContain(title);
    await expect.poll(async () => (await db.mattermost_notifications.findMany({ where: { notification_type: 'event_invited' } })).map(n => n.user_id).sort(), { timeout: 8000 }).toEqual([USERS.suzuki.id, USERS.tanaka.id].sort());
  });

  test('自分を参加者にはできない（選択肢に出ない）。参加者は外せる', async ({ page }) => {
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /週次ミーティング/ }).click();
    await expect(page.locator('#event-attendee option', { hasText: /^管理者$/ })).toHaveCount(0);
    await page.getByRole('button', { name: '田中を参加者から外す' }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(aside(page).getByRole('button', { name: /週次ミーティング/ })).toContainText('管理者 ほか1人');
    expect((await db.calendar_event_attendees.findMany({ where: { event_id: 'ev_local' } })).map(a => a.user_id)).toEqual([USERS.sato.id]);
  });

  test('終日の予定を作れる', async ({ page }) => {
    const title = uniq('終日');
    await openCalendar(page);
    await page.getByRole('button', { name: '＋ 予定' }).first().click();
    await page.getByPlaceholder('タイトル').fill(title);
    await page.getByLabel('終日').check();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(aside(page).getByRole('button', { name: new RegExp(title) })).toContainText('終日');
    expect((await db.calendar_events.findFirst({ where: { title } }))!.all_day).toBe(true);
  });

  test('タイトルが空では保存できない', async ({ page }) => {
    await openCalendar(page);
    await page.getByRole('button', { name: '＋ 予定' }).first().click();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存に失敗しました')).toBeVisible();
  });

  test('既存の予定を編集できる', async ({ page }) => {
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /週次ミーティング/ }).click();
    await page.getByPlaceholder('タイトル').fill('週次ミーティング（変更）');
    await page.getByPlaceholder('場所').fill('会議室C');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(aside(page).getByRole('button', { name: /週次ミーティング（変更）/ })).toContainText('会議室C');
    expect((await db.calendar_events.findUnique({ where: { id: 'ev_local' } }))!.title).toBe('週次ミーティング（変更）');
  });

  test('予定を削除できる（確認ダイアログあり）。参加者のカレンダーからも消える', async ({ page, as }) => {
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /週次ミーティング/ }).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '削除' }).click();
    await expect(aside(page).getByRole('button', { name: /週次ミーティング/ })).toHaveCount(0);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_local' } })).toBeNull();
    expect(await titles(await (await as('sato')).get(mineUrl))).not.toContain('週次ミーティング');
  });

  test('削除の確認で「キャンセル」すると残る', async ({ page }) => {
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /週次ミーティング/ }).click();
    page.once('dialog', d => d.dismiss());
    await page.getByRole('button', { name: '削除' }).click();
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_local' } })).not.toBeNull();
  });

  test('タイトルに入れたHTMLは文字として表示され、実行されない', async ({ page }) => {
    const payload = `<img src=x onerror="window.__xss=1">${uniq('x')}`;
    await db.calendar_events.create({ data: { title: payload, source: 'local', start_at: todayAt('18:00'), end_at: todayAt('19:00'), owner_user_id: USERS.admin.id, created_by_id: USERS.admin.id } });
    await openCalendar(page);
    await expect(aside(page)).toContainText('<img src=x');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });
});

test.describe('参加者として入っている予定', () => {
  test.use({ storageState: AUTH.tanaka });

  test('開くと、入力欄は編集できず、保存・削除のボタンもない。誰の予定かが出る', async ({ page }) => {
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /週次ミーティング/ }).click();
    await expect(page.getByPlaceholder('タイトル')).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '削除' })).toHaveCount(0);
    await expect(page.getByTestId('event-owner')).toContainText('管理者 さんの予定（参加者として入っています）');
  });

  test('参加者は、変更も削除もできない（403）', async ({ as }) => {
    const c = await as('tanaka');
    expect((await c.patch('/api/calendar/events/ev_local', { data: { title: '乗っ取り' } })).status()).toBe(403);
    expect((await c.delete('/api/calendar/events/ev_local')).status()).toBe(403);
    expect((await db.calendar_events.findUnique({ where: { id: 'ev_local' } }))!.title).toBe('週次ミーティング');
  });

  test('自分の予定は、いつでも作れる', async ({ as }) => {
    const res = await (await as('tanaka')).post('/api/calendar/events', { data: { title: uniq('田中の予定'), start_at: todayAt('10:00').toISOString(), end_at: todayAt('11:00').toISOString() } });
    expect(res.status()).toBe(201);
  });
});

test.describe('取り込んだ予定の名前変更（佐藤）', () => {
  test.use({ storageState: AUTH.sato });

  test('名前を付けると表示が変わり、空にすると「予定あり」に戻る', async ({ page }) => {
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /予定あり/ }).first().click();
    await expect(page.getByText('Googleから取り込んだ予定')).toBeVisible();
    await expect(page.getByText('Googleの予定は読み取り専用です')).toBeVisible();
    await page.locator('input[placeholder="予定あり"]').fill('A社 商談（外出）');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(aside(page).getByRole('button', { name: /A社 商談（外出）/ })).toContainText('名称変更済');
    expect((await db.calendar_events.findUnique({ where: { id: 'ev_busy' } }))!.title_override).toBe('A社 商談（外出）');

    await aside(page).getByRole('button', { name: /A社 商談（外出）/ }).click();
    await page.locator('input[placeholder="予定あり"]').fill('');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(aside(page).getByRole('button', { name: /A社 商談/ })).toHaveCount(0);
    expect((await db.calendar_events.findUnique({ where: { id: 'ev_busy' } }))!.title_override).toBeNull();
  });

  test('取り込んだ予定は削除できない（読み取り専用）', async ({ as }) => {
    expect((await (await as('sato')).delete('/api/calendar/events/ev_busy')).status()).toBe(400);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_busy' } })).not.toBeNull();
  });

  test('取り込んだ予定に、タイトルや場所を書き込もうとしても名前変更しか効かない', async ({ as }) => {
    const res = await (await as('sato')).patch('/api/calendar/events/ev_busy', { data: { title_override: '新名称', title: '偽タイトル', location: '偽の場所' } });
    expect(res.status()).toBe(200);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_busy' } })).toMatchObject({ title_override: '新名称', title: null, location: null });
  });

  test('ほかの人（管理者）は、佐藤のGoogleの予定の名前を変えられない', async ({ as }) => {
    expect((await (await as('admin')).patch('/api/calendar/events/ev_busy', { data: { title_override: '改名' } })).status()).toBe(403);
  });
});

test.describe('見られる人（API）', () => {
  test('共有メールのメンバーのカレンダーは、そのメールを見られる人だけ。鈴木（メンバーでない）は403', async ({ as }) => {
    expect((await (await as('suzuki')).get(teamUrl)).status()).toBe(403);
    for (const who of ['admin', 'admin2', 'sato', 'tanaka'] as const) expect((await (await as(who)).get(teamUrl)).status()).toBe(200);
  });

  test('自分のカレンダーには、自分が持ち主か参加者の予定だけが出る', async ({ as }) => {
    expect(await titles(await (await as('admin')).get(mineUrl))).toEqual(['週次ミーティング']);
    expect(await titles(await (await as('sato')).get(mineUrl))).toEqual(['週次ミーティング', '予定あり', '社内MTG'].sort());
    expect(await titles(await (await as('admin2')).get(mineUrl))).toEqual(['全体会議']);
    expect(await titles(await (await as('suzuki')).get(mineUrl))).toEqual([]);
  });

  test('共有メールを選ぶと、メンバー全員の予定が1件ずつ出る。メンバーの一覧と、招待できる人の一覧も付く', async ({ as }) => {
    const d = await (await (await as('tanaka')).get(teamUrl)).json();
    expect(d.items.map((i: { title: string }) => i.title).sort()).toEqual(['全体会議', '社内MTG', '予定あり', '週次ミーティング'].sort());
    expect(d.people.map((p: { id: string }) => p.id).sort()).toEqual([USERS.admin.id, USERS.admin2.id, USERS.sato.id, USERS.tanaka.id].sort());
    expect(d.everybody.length).toBeGreaterThan(d.people.length); // 鈴木など、メンバーでない人も招待できる
  });

  test('一覧のクエリが不正なら400。指定期間の予定だけを返す', async ({ as }) => {
    const c = await as('admin');
    expect((await c.get('/api/calendar/events')).status()).toBe(400);
    expect((await c.get('/api/calendar/events?from=bad&to=bad')).status()).toBe(400);
    const farFrom = encodeURIComponent(new Date(Date.now() + 300 * 86400_000).toISOString());
    const farTo = encodeURIComponent(new Date(Date.now() + 301 * 86400_000).toISOString());
    expect((await (await c.get(`/api/calendar/events?from=${farFrom}&to=${farTo}`)).json()).items).toEqual([]);
    expect(addDays(today(), 0)).toBe(today());
  });

  test('予定ごとに、編集できるか（can_edit）が分かる', async ({ as }) => {
    const byId = async (who: 'admin' | 'tanaka') => Object.fromEntries((await (await (await as(who)).get(teamUrl)).json()).items.map((i: { id: string; can_edit: boolean }) => [i.id, i.can_edit]));
    expect(await byId('admin')).toMatchObject({ ev_local: true, ev_busy: false, ev_full: false });
    expect(await byId('tanaka')).toMatchObject({ ev_local: false, ev_busy: false });
  });
});

test.describe('作成・更新の入力（API）', () => {
  const valid = () => ({ title: uniq('t'), start_at: todayAt('10:00').toISOString(), end_at: todayAt('11:00').toISOString() });
  for (const [label, patch] of [
    ['タイトルが空', { title: '' }],
    ['タイトルが201文字', { title: 'a'.repeat(201) }],
    ['終了が開始より前', { end_at: todayAt('09:00').toISOString() }],
    ['日付が不正', { start_at: 'bad' }],
    ['社内にいない人を参加者にする', { attendee_ids: ['u_nobody'] }],
  ] as const) {
    test(`作成: ${label} は400`, async ({ as }) => {
      expect((await (await as('admin')).post('/api/calendar/events', { data: { ...valid(), ...patch } })).status()).toBe(400);
    });
  }

  test('作成: 持ち主は必ず自分（owner_user_id を送っても効かない）。自分を参加者にしても入らない。同じ人を2回指定しても1回', async ({ as }) => {
    const body = { ...valid(), owner_user_id: USERS.sato.id, attendee_ids: [USERS.admin.id, USERS.tanaka.id, USERS.tanaka.id] };
    const res = await (await as('admin')).post('/api/calendar/events', { data: body });
    expect(res.status()).toBe(201);
    const row = await db.calendar_events.findUniqueOrThrow({ where: { id: (await res.json()).id }, include: { attendees: true } });
    expect(row.owner_user_id).toBe(USERS.admin.id);
    expect(row.attendees.map(a => a.user_id)).toEqual([USERS.tanaka.id]);
  });

  test('更新: 終了を開始より前にする更新は400で、元の値が残る', async ({ as }) => {
    const res = await (await as('admin')).patch('/api/calendar/events/ev_local', { data: { end_at: todayAt('08:00').toISOString() } });
    expect(res.status()).toBe(400);
    expect((await db.calendar_events.findUnique({ where: { id: 'ev_local' } }))!.end_at.getTime()).toBe(todayAt('11:00').getTime());
  });

  test('更新: 参加者を入れ替えられる。新しく入った人だけに通知が届く', async ({ as }) => {
    await clearNotifications();
    const res = await (await as('admin')).patch('/api/calendar/events/ev_local', { data: { attendee_ids: [USERS.sato.id, USERS.suzuki.id] } });
    expect(res.status()).toBe(200);
    expect((await db.calendar_event_attendees.findMany({ where: { event_id: 'ev_local' } })).map(a => a.user_id).sort()).toEqual([USERS.sato.id, USERS.suzuki.id].sort());
    await expect.poll(async () => (await db.mattermost_notifications.findMany({ where: { notification_type: 'event_invited' } })).map(n => n.user_id), { timeout: 8000 }).toEqual([USERS.suzuki.id]);
  });

  test('存在しない予定は404', async ({ as }) => {
    const c = await as('admin');
    expect((await c.patch('/api/calendar/events/nope', { data: { title: 'x' } })).status()).toBe(404);
    expect((await c.delete('/api/calendar/events/nope')).status()).toBe(404);
  });

  test('予定を作った人は、持ち主でなくても変えられる（持ち主が作ってもらった予定）', async ({ as }) => {
    await db.calendar_events.update({ where: { id: 'ev_local' } , data: { owner_user_id: USERS.sato.id, created_by_id: USERS.admin.id } });
    expect((await (await as('admin')).patch('/api/calendar/events/ev_local', { data: { title: '作った人の変更' } })).status()).toBe(200);
    expect((await (await as('sato')).patch('/api/calendar/events/ev_local', { data: { title: '持ち主の変更' } })).status()).toBe(200);
    expect((await (await as('tanaka')).patch('/api/calendar/events/ev_local', { data: { title: '他人' } })).status()).toBe(403);
  });
});

test.describe('「予定ありのみ」の情報漏えい防止（API）', () => {
  for (const role of ['admin', 'admin2', 'sato', 'tanaka'] as const) {
    test(`${USERS[role].name}への一覧には、予定ありのみの連携予定の詳細が含まれない`, async ({ as }) => {
      await db.calendar_events.update({ where: { id: 'ev_busy' }, data: { title: '秘密の面談', description: '機密メモ', location: '極秘会議室' } });
      const text = await (await (await as(role)).get(teamUrl)).text();
      expect(text).not.toContain('秘密の面談');
      expect(text).not.toContain('機密メモ');
      expect(text).not.toContain('極秘会議室');
      expect(JSON.parse(text).items.find((i: { id: string }) => i.id === 'ev_busy')).toMatchObject({ title: '予定あり', original_title: null, description: null, location: null });
    });
  }

  test('詳細表示の連携予定は、メンバーに詳細が返る', async ({ as }) => {
    const item = (await (await (await as('tanaka')).get(teamUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_full');
    expect(item).toMatchObject({ title: '全体会議', location: '大会議室', description: '四半期レビュー' });
  });

  test('連携の設定情報は、持ち主本人にだけ返る（ほかの人の連携は一覧に出ない）。暗号化トークンは含まれない', async ({ as }) => {
    expect((await (await (await as('tanaka')).get(teamUrl)).json()).links).toEqual([]);
    const text = await (await (await as('sato')).get(teamUrl)).text();
    expect(JSON.parse(text).links.map((l: { id: string }) => l.id)).toEqual(['l_busy']);
    expect(text).not.toContain('encrypted_token');
  });

  test('「詳細も表示」を「予定ありのみ」に切り替えると、保存済みの詳細が消える', async ({ as }) => {
    expect((await (await as('admin2')).patch('/api/calendar/links/l_full', { data: { display_mode: 'busy_only' } })).status()).toBe(200);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_full' } })).toMatchObject({ title: null, description: null, location: null });
    const item = (await (await (await as('tanaka')).get(teamUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_full');
    expect(item.title).toBe('予定あり');
  });

  test('「予定ありのみ」に切り替えても、持ち主が付けた名前は残る', async ({ as }) => {
    await db.calendar_events.update({ where: { id: 'ev_full' }, data: { title_override: '経営会議' } });
    await (await as('admin2')).patch('/api/calendar/links/l_full', { data: { display_mode: 'busy_only' } });
    const item = (await (await (await as('tanaka')).get(teamUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_full');
    expect(item.title).toBe('経営会議');
  });
});

test.describe('Googleカレンダー連携（自分のもの）', () => {
  test('連携の設定画面には、自分が連携したカレンダーだけが出る', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await page.getByRole('button', { name: 'Google連携' }).click();
    await expect(page.getByText('Googleカレンダー連携')).toBeVisible();
    await expect(page.locator('input[value="佐藤さんのGoogleカレンダー"]')).toBeVisible();
    await expect(page.locator('input[value="副管理者Google"]')).toHaveCount(0);
    await expect(page.getByLabel('予定ありのみ')).toHaveCount(1);
    await expect(page.getByRole('link', { name: '＋ Googleカレンダーを連携' })).toHaveAttribute('href', '/api/calendar/google/auth');
    await ctx.close();
  });

  test('連携がない人にも「連携」の入口がある（誰でも自分のカレンダーに連携できる）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await page.getByRole('button', { name: 'Google連携' }).click();
    await expect(page.getByRole('link', { name: '＋ Googleカレンダーを連携' })).toBeVisible();
    await ctx.close();
  });

  test('表示ラベルを変更でき、メンバーにも反映される', async ({ as }) => {
    expect((await (await as('sato')).patch('/api/calendar/links/l_busy', { data: { busy_label: '外出中' } })).status()).toBe(200);
    const item = (await (await (await as('tanaka')).get(teamUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_busy');
    expect(item.title).toBe('外出中');
  });

  for (const [label, role, linkId, expected] of [
    ['佐藤は自分の連携を変更できる', 'sato', 'l_busy', 200],
    ['佐藤は他人（副管理者）の連携を変更できない', 'sato', 'l_full', 403],
    ['田中は変更できない', 'tanaka', 'l_busy', 403],
    ['鈴木は変更できない', 'suzuki', 'l_busy', 403],
    ['管理者でも、他人の連携は変更できない（Googleのカレンダーは本人のもの）', 'admin', 'l_full', 403],
  ] as const) {
    test(`連携の変更: ${label}`, async ({ as }) => {
      expect((await (await as(role)).patch(`/api/calendar/links/${linkId}`, { data: { name: uniq('名称') } })).status()).toBe(expected);
    });
  }

  test('連携の解除: 取り込んだ予定も一緒に消える。他人の連携は解除できない', async ({ as }) => {
    expect((await (await as('sato')).delete('/api/calendar/links/l_full')).status()).toBe(403);
    expect(await db.calendar_google_links.findUnique({ where: { id: 'l_full' } })).not.toBeNull();
    expect((await (await as('admin2')).delete('/api/calendar/links/l_full')).status()).toBe(200);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_full' } })).toBeNull();
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_local' } })).not.toBeNull();
  });

  for (const [label, data] of [
    ['色の形式が不正', { color: 'red' }],
    ['表示モードが不正', { display_mode: 'everything' }],
    ['ラベルが空', { busy_label: '' }],
    ['名前が101文字', { name: 'a'.repeat(101) }],
  ] as const) {
    test(`連携の変更: ${label} は400`, async ({ as }) => {
      expect((await (await as('sato')).patch('/api/calendar/links/l_busy', { data })).status()).toBe(400);
    });
  }

  test('存在しない連携は404。他人の連携の手動同期は403', async ({ as }) => {
    expect((await (await as('admin')).patch('/api/calendar/links/nope', { data: { name: 'x' } })).status()).toBe(404);
    expect((await (await as('tanaka')).post('/api/calendar/links/l_busy/sync')).status()).toBe(403);
  });

  test('同期に失敗しても（トークン不正）エラーとして返り、既存の予定は消えない', async ({ as }) => {
    expect((await (await as('sato')).post('/api/calendar/links/l_busy/sync')).status()).toBe(502);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_busy' } })).not.toBeNull();
    expect((await db.calendar_google_links.findUnique({ where: { id: 'l_busy' } }))!.last_error).toBeTruthy();
  });
});

test.describe('Google OAuth の開始と戻り', () => {
  test('ログインしている人は誰でも、Googleの認可画面へ移動する（state用のCookieも付く）', async ({ as }) => {
    for (const who of ['sato', 'tanaka', 'suzuki'] as const) {
      const res = await (await as(who)).get('/api/calendar/google/auth', { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      const url = new URL(res.headers()['location']);
      expect(url.host).toBe('accounts.google.com');
      expect(url.searchParams.get('client_id')).toBe('e2e-client.apps.googleusercontent.com');
      expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/calendar\/google\/callback$/);
      const state = url.searchParams.get('state')!;
      expect(res.headers()['set-cookie']).toContain(`gcal_oauth_state=${state}`);
      expect(res.headers()['set-cookie']).toContain('HttpOnly');
    }
  });

  test('毎回違うstate（CSRF対策）になる', async ({ as }) => {
    const c = await as('admin');
    const get = async () => new URL((await c.get('/api/calendar/google/auth', { maxRedirects: 0 })).headers()['location']).searchParams.get('state');
    expect(await get()).not.toBe(await get());
  });

  test('未ログインで開始すると、ログイン画面へ', async ({ anon }) => {
    const res = await anon.get('/api/calendar/google/auth', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/login');
  });

  test('戻りのstateがCookieと一致しないと、連携は作られずエラーで戻る', async ({ as }) => {
    const before = await db.calendar_google_links.count();
    const res = await (await as('admin')).get('/api/calendar/google/callback?code=abc&state=forged', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('google_error=invalid_state');
    expect(await db.calendar_google_links.count()).toBe(before);
  });

  test('ユーザーが認可を拒否した場合も連携は作られない', async ({ as }) => {
    const c = await as('admin');
    const start = await c.get('/api/calendar/google/auth', { maxRedirects: 0 });
    const state = new URL(start.headers()['location']).searchParams.get('state')!;
    const res = await c.get(`/api/calendar/google/callback?error=access_denied&state=${state}`, { maxRedirects: 0 });
    expect(res.headers()['location']).toContain('google_error=access_denied');
  });

  test('未ログインで戻りのURLを開くとログイン画面へ', async ({ anon }) => {
    const res = await anon.get('/api/calendar/google/callback?code=x&state=y', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/login');
  });
});

test.describe('カレンダー（日付の扱い）', () => {
  test('日本時間の23:30の予定は、その日の予定として表示される', async ({ browser }) => {
    await db.calendar_events.create({ data: { id: 'ev_late', title: '深夜対応', source: 'local', start_at: todayAt('23:30'), end_at: new Date(todayAt('23:30').getTime() + 20 * 60_000), owner_user_id: USERS.admin.id, created_by_id: USERS.admin.id } });
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await expect(aside(page).getByRole('button', { name: /深夜対応/ })).toContainText('23:30');
    await ctx.close();
  });

  test('複数日にまたがる予定は、期間中の各日に表示される', async ({ browser }) => {
    const start = todayAt('09:00');
    await db.calendar_events.create({ data: { id: 'ev_multi', title: '3日間の研修', source: 'local', start_at: start, end_at: new Date(start.getTime() + 2 * 86400_000), owner_user_id: USERS.admin.id, created_by_id: USERS.admin.id } });
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    const count = await page.locator('main .grid-cols-7 button', { hasText: '3日間の研修' }).count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
    await ctx.close();
  });

  test('今日は丸く強調される', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    const day = String(Number(today().slice(8)));
    await expect(page.locator('main .grid-cols-7 button div.rounded-full', { hasText: new RegExp(`^${day}$`) })).toBeVisible();
    await ctx.close();
  });
});

test.describe('取り込むGoogleカレンダーの選択', () => {
  test.use({ storageState: AUTH.sato });
  const unlinked = () => db.calendar_google_links.create({ data: { id: 'l_pick', linked_by_user_id: USERS.sato.id, encrypted_token: 'x', name: '新しい連携' } });

  test('一覧が読めないときは、理由と直し方が出る。Calendar APIが無効ならそう教える。直ったら「もう一度読み込む」で選べる', async ({ page }) => {
    await unlinked();
    let answer: { status: number; body: object } = { status: 502, body: { error: 'api_disabled' } };
    await page.route('**/api/calendar/links/l_pick/calendars', route => route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) }));
    await page.goto('/calendar?link=l_pick');   // coming back from Google opens the settings by itself
    const alert = page.getByRole('dialog', { name: 'Googleカレンダー連携' }).getByRole('alert');
    await expect(alert).toContainText('「Google Calendar API」が有効になっていません');
    answer = { status: 200, body: { items: [{ id: 'primary', name: '佐藤', primary: true }, { id: 'team', name: 'チーム', primary: false }] } };
    await alert.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.getByText('「Google Calendar API」が有効になっていません')).toHaveCount(0);
    await expect(page.getByRole('option', { name: '佐藤（メイン）' })).toBeAttached();
    await expect(page.getByRole('option', { name: 'チーム', exact: true })).toBeAttached();
  });

  test('権限が足りないとき・読めるカレンダーが0件のときも、それぞれ案内が出る', async ({ page }) => {
    await unlinked();
    await page.route('**/api/calendar/links/l_pick/calendars', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'insufficient_scope' }) }));
    await page.goto('/calendar?link=l_pick');
    await expect(page.getByText('「カレンダーを表示」にチェックを入れて許可してください')).toBeVisible();
    await page.unroute('**/api/calendar/links/l_pick/calendars');
    await page.route('**/api/calendar/links/l_pick/calendars', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
    await page.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.getByText('読み取れるカレンダーがありません')).toBeVisible();
  });
});
