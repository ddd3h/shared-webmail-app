import { test, expect, uniq } from './fixtures';
import { AUTH, MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { seedCalendar, todayAt } from './helpers/seed';
import { addDays, today } from './helpers/ui';

test.beforeEach(async () => { await seedCalendar(); });

const range = () => `from=${encodeURIComponent(new Date(Date.now() - 40 * 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 40 * 86400_000).toISOString())}`;
const listUrl = `/api/calendar/events?mailboxId=${MAILBOX_ID}&${range()}`;
const aside = (page: import('@playwright/test').Page) => page.locator('aside');

async function openCalendar(page: import('@playwright/test').Page) {
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { level: 1, name: 'カレンダー' })).toBeVisible();
  await expect(aside(page)).toContainText('週次ミーティング');
}

test.describe('カレンダーの表示（管理者）', () => {
  test.use({ storageState: AUTH.admin });

  test('今日の予定が一覧と月表示に出る', async ({ page }) => {
    await openCalendar(page);
    await expect(aside(page).getByText('週次ミーティング')).toBeVisible();
    await expect(page.locator('main .grid-cols-7 button', { hasText: '週次ミーティング' })).toBeVisible();
  });

  test('メールアカウントの選択に営業チーム共有が出る', async ({ page }) => {
    await openCalendar(page);
    await expect(page.locator('select').first()).toContainText('営業チーム共有');
  });

  test('「予定ありのみ」の連携予定は「予定あり」とだけ表示される', async ({ page }) => {
    await openCalendar(page);
    await expect(aside(page).getByText('予定あり', { exact: true })).toBeVisible();
    await expect(page.getByText('原本タイトル')).toHaveCount(0);
  });

  test('こちら側で付けた名前が表示され「名称変更済」と出る', async ({ page }) => {
    await openCalendar(page);
    const item = aside(page).getByRole('button', { name: /社内MTG/ });
    await expect(item).toBeVisible();
    await expect(item).toContainText('名称変更済');
  });

  test('詳細表示の連携予定はタイトルと場所が見える', async ({ page }) => {
    await openCalendar(page);
    const item = aside(page).getByRole('button', { name: /全体会議/ });
    await expect(item).toContainText('大会議室');
  });

  test('予定の一覧には誰の予定かが出る', async ({ page }) => {
    await openCalendar(page);
    await expect(aside(page).getByRole('button', { name: /週次ミーティング/ })).toContainText('チーム全体');
    await expect(aside(page).getByRole('button', { name: /社内MTG/ })).toContainText('佐藤');
    await expect(aside(page).getByRole('button', { name: /全体会議/ })).toContainText('副管理者');
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
    await page.getByRole('button', { name: '前の月' }).click();
    await expect(label).not.toHaveText(first!);
  });

  test('日付をクリックするとその日の予定一覧に切り替わる', async ({ page }) => {
    await openCalendar(page);
    await page.locator('main .grid-cols-7 button').filter({ hasNotText: '週次ミーティング' }).filter({ hasText: /^\d+$/ }).first().click();
    await expect(aside(page)).toContainText('予定はありません');
  });
});

test.describe('予定の作成・編集・削除（管理者）', () => {
  test.use({ storageState: AUTH.admin });

  test('タイトルと場所を入れて予定を追加できる', async ({ page }) => {
    const title = uniq('営業会議');
    await openCalendar(page);
    await page.getByRole('button', { name: '＋ 予定' }).first().click();
    await page.getByPlaceholder('タイトル').fill(title);
    await page.getByPlaceholder('場所').fill('会議室B');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect(aside(page).getByRole('button', { name: new RegExp(title) })).toContainText('会議室B');
    const row = await db.calendar_events.findFirst({ where: { title } });
    expect(row).toMatchObject({ source: 'local', owner_user_id: null, created_by_id: USERS.admin.id, location: '会議室B' });
  });

  test('「誰の予定」を選んで追加すると、その人の予定になる', async ({ page }) => {
    const title = uniq('佐藤の外出');
    await openCalendar(page);
    await page.getByRole('button', { name: '＋ 予定' }).first().click();
    await page.getByPlaceholder('タイトル').fill(title);
    await page.locator('select').filter({ hasText: 'チーム全体' }).last().selectOption(USERS.sato.id);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(aside(page).getByRole('button', { name: new RegExp(title) })).toContainText('佐藤');
    expect((await db.calendar_events.findFirst({ where: { title } }))!.owner_user_id).toBe(USERS.sato.id);
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

  test('予定を削除できる（確認ダイアログあり）', async ({ page }) => {
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /週次ミーティング/ }).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '削除' }).click();
    await expect(aside(page).getByRole('button', { name: /週次ミーティング/ })).toHaveCount(0);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_local' } })).toBeNull();
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
    await db.calendar_events.create({ data: { mailbox_id: MAILBOX_ID, title: payload, source: 'local', start_at: todayAt('18:00'), end_at: todayAt('19:00') } });
    await openCalendar(page);
    await expect(aside(page)).toContainText('<img src=x');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
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
    const res = await (await as('sato')).delete('/api/calendar/events/ev_busy');
    expect(res.status()).toBe(400);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_busy' } })).not.toBeNull();
  });

  test('取り込んだ予定に、タイトルや場所を書き込もうとしても名前変更しか効かない', async ({ as }) => {
    const res = await (await as('sato')).patch('/api/calendar/events/ev_busy', { data: { title_override: '新名称', title: '偽タイトル', location: '偽の場所' } });
    expect(res.status()).toBe(200);
    const row = await db.calendar_events.findUnique({ where: { id: 'ev_busy' } });
    expect(row).toMatchObject({ title_override: '新名称', title: null, location: null });
  });
});

test.describe('人ごとの表示切り替え', () => {
  test.use({ storageState: AUTH.admin });

  test('表示する人のチップに、閲覧できるメンバー全員が並ぶ', async ({ page }) => {
    await openCalendar(page);
    for (const n of ['チーム全体', '管理者（自分）', '副管理者', '佐藤', '田中']) await expect(page.getByRole('button', { name: new RegExp(n) }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /鈴木/ })).toHaveCount(0);
  });

  test('「自分のみ」にすると他の人の予定が消え、「全員」で戻る', async ({ page }) => {
    await openCalendar(page);
    await page.getByRole('button', { name: '自分のみ' }).click();
    await expect(aside(page).getByText('週次ミーティング')).toHaveCount(0);
    await expect(aside(page).getByText('社内MTG')).toHaveCount(0);
    await page.getByRole('button', { name: '全員' }).click();
    await expect(aside(page).getByText('週次ミーティング')).toBeVisible();
    await expect(aside(page).getByText('社内MTG')).toBeVisible();
  });

  test('人のチップを1つ切ると、その人の予定だけ消える', async ({ page }) => {
    await openCalendar(page);
    const chip = page.getByRole('button', { name: /^佐藤/ });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(aside(page).getByText('社内MTG')).toHaveCount(0);
    await expect(aside(page).getByText('全体会議')).toBeVisible();
    await expect(aside(page).getByText('週次ミーティング')).toBeVisible();
  });

  test('「チーム全体」を切ると、担当者のいない予定だけ消える', async ({ page }) => {
    await openCalendar(page);
    await page.getByRole('button', { name: /^チーム全体/ }).click();
    await expect(aside(page).getByText('週次ミーティング')).toHaveCount(0);
    await expect(aside(page).getByText('社内MTG')).toBeVisible();
  });
});

test.describe('権限（画面）', () => {
  test('閲覧のみの田中には「＋ 予定」「Google連携」が出ない', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await expect(page.getByRole('button', { name: '＋ 予定' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Google連携' })).toHaveCount(0);
    await expect(aside(page).getByRole('button', { name: '追加' })).toHaveCount(0);
    await ctx.close();
  });

  test('閲覧のみの田中が予定を開くと、入力欄は編集できず保存ボタンもない', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await aside(page).getByRole('button', { name: /週次ミーティング/ }).click();
    await expect(page.getByPlaceholder('タイトル')).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '削除' })).toHaveCount(0);
    await ctx.close();
  });

  test('カレンダーを見られない鈴木には案内メッセージが出る', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.suzuki, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/calendar');
    await expect(page.getByText('閲覧できるメールアカウントがありません')).toBeVisible();
    await ctx.close();
  });

  test('編集できる佐藤には「＋ 予定」と「Google連携」が出る', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await expect(page.getByRole('button', { name: '＋ 予定' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Google連携' })).toBeVisible();
    await ctx.close();
  });
});

test.describe('権限・入力検証（API）', () => {
  test('閲覧権限のない鈴木は予定一覧が403', async ({ as }) => {
    expect((await (await as('suzuki')).get(listUrl)).status()).toBe(403);
  });

  test('閲覧のみの田中は一覧は見られるが、作成・編集・削除は403', async ({ as }) => {
    const c = await as('tanaka');
    expect((await c.get(listUrl)).status()).toBe(200);
    const body = { mailboxId: MAILBOX_ID, title: 'x', start_at: todayAt('10:00').toISOString(), end_at: todayAt('11:00').toISOString() };
    expect((await c.post('/api/calendar/events', { data: body })).status()).toBe(403);
    expect((await c.patch('/api/calendar/events/ev_local', { data: { title: 'y' } })).status()).toBe(403);
    expect((await c.delete('/api/calendar/events/ev_local')).status()).toBe(403);
    expect((await db.calendar_events.findUnique({ where: { id: 'ev_local' } }))!.title).toBe('週次ミーティング');
  });

  test('一覧のクエリが不正なら400', async ({ as }) => {
    const c = await as('admin');
    expect((await c.get(`/api/calendar/events?mailboxId=${MAILBOX_ID}`)).status()).toBe(400);
    expect((await c.get(`/api/calendar/events?${range()}`)).status()).toBe(400);
    expect((await c.get(`/api/calendar/events?mailboxId=${MAILBOX_ID}&from=bad&to=bad`)).status()).toBe(400);
  });

  const valid = () => ({ mailboxId: MAILBOX_ID, title: uniq('t'), start_at: todayAt('10:00').toISOString(), end_at: todayAt('11:00').toISOString() });
  for (const [label, patch] of [
    ['タイトルが空', { title: '   ' }],
    ['タイトルが201文字', { title: 'あ'.repeat(201) }],
    ['終了が開始より前', { start_at: todayAt('12:00').toISOString(), end_at: todayAt('11:00').toISOString() }],
    ['日時が不正', { start_at: 'not-a-date' }],
    ['メモが長すぎる', { description: 'a'.repeat(5001) }],
    ['担当者がメンバーではない（鈴木は閲覧権限なし）', { owner_user_id: USERS.suzuki.id }],
    ['担当者が存在しない', { owner_user_id: 'nobody' }],
  ] as const) {
    test(`作成: ${label} は400`, async ({ as }) => {
      const res = await (await as('admin')).post('/api/calendar/events', { data: { ...valid(), ...patch } });
      expect(res.status()).toBe(400);
    });
  }

  test('作成: メンバーを担当者にでき、不要な項目は保存されない', async ({ as }) => {
    const data = { ...valid(), owner_user_id: USERS.tanaka.id, description: 'メモ', location: '本社' };
    const res = await (await as('admin')).post('/api/calendar/events', { data });
    expect(res.status()).toBe(201);
    const row = await db.calendar_events.findUnique({ where: { id: (await res.json()).id } });
    expect(row).toMatchObject({ owner_user_id: USERS.tanaka.id, description: 'メモ', location: '本社', source: 'local' });
  });

  test('編集: 終了を開始より前にする更新は400で、元の値が残る', async ({ as }) => {
    const res = await (await as('admin')).patch('/api/calendar/events/ev_local', { data: { end_at: todayAt('08:00').toISOString() } });
    expect(res.status()).toBe(400);
    expect((await db.calendar_events.findUnique({ where: { id: 'ev_local' } }))!.end_at.toISOString()).toBe(todayAt('11:00').toISOString());
  });

  test('存在しない予定は404', async ({ as }) => {
    const c = await as('admin');
    expect((await c.patch('/api/calendar/events/nope', { data: { title: 'x' } })).status()).toBe(404);
    expect((await c.delete('/api/calendar/events/nope')).status()).toBe(404);
  });

  test('メンバー一覧は閲覧権限のある人だけ（鈴木は含まれない）', async ({ as }) => {
    const body = await (await (await as('admin')).get(listUrl)).json();
    expect(body.people.map((p: { id: string }) => p.id).sort()).toEqual([USERS.admin.id, USERS.admin2.id, USERS.sato.id, USERS.tanaka.id].sort());
  });
});

test.describe('「予定ありのみ」の情報漏えい防止（API）', () => {
  for (const role of ['admin', 'admin2', 'sato', 'tanaka'] as const) {
    test(`${USERS[role].name}への一覧には、予定ありのみの連携予定の詳細が含まれない`, async ({ as }) => {
      await db.calendar_events.update({ where: { id: 'ev_busy' }, data: { title: '秘密の面談', description: '機密メモ', location: '極秘会議室' } });
      const res = await (await as(role)).get(listUrl);
      const text = await res.text();
      expect(text).not.toContain('秘密の面談');
      expect(text).not.toContain('機密メモ');
      expect(text).not.toContain('極秘会議室');
      const item = JSON.parse(text).items.find((i: { id: string }) => i.id === 'ev_busy');
      expect(item).toMatchObject({ title: '予定あり', original_title: null, description: null, location: null });
    });
  }

  test('詳細表示の連携予定は、閲覧できる人に詳細が返る', async ({ as }) => {
    const item = (await (await (await as('tanaka')).get(listUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_full');
    expect(item).toMatchObject({ title: '全体会議', location: '大会議室', description: '四半期レビュー' });
  });

  test('連携の設定情報（口座のようなもの）は管理できない人には返らない', async ({ as }) => {
    expect((await (await (await as('tanaka')).get(listUrl)).json()).links).toEqual([]);
  });

  test('管理者には連携の設定が返り、暗号化トークンは含まれない', async ({ as }) => {
    const text = await (await (await as('admin')).get(listUrl)).text();
    expect(JSON.parse(text).links.map((l: { id: string }) => l.id).sort()).toEqual(['l_busy', 'l_full']);
    expect(text).not.toContain('encrypted_token');
  });

  test('「詳細も表示」を「予定ありのみ」に切り替えると、保存済みの詳細が消える', async ({ as }) => {
    const res = await (await as('admin')).patch('/api/calendar/links/l_full', { data: { display_mode: 'busy_only' } });
    expect(res.status()).toBe(200);
    const ev = await db.calendar_events.findUnique({ where: { id: 'ev_full' } });
    expect(ev).toMatchObject({ title: null, description: null, location: null });
    const item = (await (await (await as('tanaka')).get(listUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_full');
    expect(item.title).toBe('予定あり');
  });

  test('「予定ありのみ」に切り替えても、こちらで付けた名前は残る', async ({ as }) => {
    await db.calendar_events.update({ where: { id: 'ev_full' }, data: { title_override: '経営会議' } });
    await (await as('admin')).patch('/api/calendar/links/l_full', { data: { display_mode: 'busy_only' } });
    const item = (await (await (await as('tanaka')).get(listUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_full');
    expect(item.title).toBe('経営会議');
  });
});

test.describe('Google連携の管理', () => {
  test('連携の設定画面に2件の連携と、表示モード・ラベルが出る', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await page.getByRole('button', { name: 'Google連携' }).click();
    await expect(page.getByText('Googleカレンダー連携')).toBeVisible();
    await expect(page.locator('input[value="佐藤さんのGoogleカレンダー"]')).toBeVisible();
    await expect(page.locator('input[value="副管理者Google"]')).toBeVisible();
    await expect(page.getByLabel('予定ありのみ')).toHaveCount(2);
    await expect(page.getByRole('link', { name: '＋ Googleカレンダーを連携' })).toHaveAttribute('href', new RegExp(`mailboxId=${MAILBOX_ID}`));
    await ctx.close();
  });

  test('佐藤は自分が連携したカレンダーだけが設定画面に出る', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await page.getByRole('button', { name: 'Google連携' }).click();
    await expect(page.locator('input[value="佐藤さんのGoogleカレンダー"]')).toBeVisible();
    await expect(page.locator('input[value="副管理者Google"]')).toHaveCount(0);
    await ctx.close();
  });

  test('表示ラベルを変更できる', async ({ as }) => {
    const res = await (await as('sato')).patch('/api/calendar/links/l_busy', { data: { busy_label: '外出中' } });
    expect(res.status()).toBe(200);
    const item = (await (await (await as('tanaka')).get(listUrl)).json()).items.find((i: { id: string }) => i.id === 'ev_busy');
    expect(item.title).toBe('外出中');
  });

  for (const [label, role, linkId, expected] of [
    ['佐藤は自分の連携を変更できる', 'sato', 'l_busy', 200],
    ['佐藤は他人（副管理者）の連携を変更できない', 'sato', 'l_full', 403],
    ['閲覧のみの田中は変更できない', 'tanaka', 'l_busy', 403],
    ['鈴木（権限なし）は変更できない', 'suzuki', 'l_busy', 403],
    ['管理権限のある管理者は他人の連携も変更できる', 'admin', 'l_full', 200],
  ] as const) {
    test(`連携の変更: ${label}`, async ({ as }) => {
      const res = await (await as(role)).patch(`/api/calendar/links/${linkId}`, { data: { name: uniq('名称') } });
      expect(res.status()).toBe(expected);
    });
  }

  test('連携の解除: 取り込んだ予定も一緒に消える', async ({ as }) => {
    const res = await (await as('admin')).delete('/api/calendar/links/l_full');
    expect(res.status()).toBe(200);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_full' } })).toBeNull();
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_local' } })).not.toBeNull();
  });

  test('連携の解除: 他人の連携は解除できない', async ({ as }) => {
    expect((await (await as('sato')).delete('/api/calendar/links/l_full')).status()).toBe(403);
    expect(await db.calendar_google_links.findUnique({ where: { id: 'l_full' } })).not.toBeNull();
  });

  for (const [label, data] of [
    ['色の形式が不正', { color: 'red' }],
    ['表示モードが不正', { display_mode: 'everything' }],
    ['ラベルが空', { busy_label: '' }],
    ['名前が101文字', { name: 'a'.repeat(101) }],
  ] as const) {
    test(`連携の変更: ${label} は400`, async ({ as }) => {
      expect((await (await as('admin')).patch('/api/calendar/links/l_busy', { data })).status()).toBe(400);
    });
  }

  test('存在しない連携は404', async ({ as }) => {
    expect((await (await as('admin')).patch('/api/calendar/links/nope', { data: { name: 'x' } })).status()).toBe(404);
  });

  test('手動の同期は、編集権限のない田中には403', async ({ as }) => {
    expect((await (await as('tanaka')).post('/api/calendar/links/l_busy/sync')).status()).toBe(403);
  });

  test('同期に失敗しても（トークン不正）エラーとして返り、既存の予定は消えない', async ({ as }) => {
    const res = await (await as('sato')).post('/api/calendar/links/l_busy/sync');
    expect(res.status()).toBe(502);
    expect(await db.calendar_events.findUnique({ where: { id: 'ev_busy' } })).not.toBeNull();
    expect((await db.calendar_google_links.findUnique({ where: { id: 'l_busy' } }))!.last_error).toBeTruthy();
  });
});

test.describe('Google OAuth の開始と戻り', () => {
  test('編集権限のある人は、Googleの認可画面へ移動する（state用のCookieも付く）', async ({ as }) => {
    const res = await (await as('sato')).get(`/api/calendar/google/auth?mailboxId=${MAILBOX_ID}`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const url = new URL(res.headers()['location']);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('e2e-client.apps.googleusercontent.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/calendar\/google\/callback$/);
    const state = url.searchParams.get('state')!;
    expect(state.endsWith(`.${MAILBOX_ID}`)).toBe(true);
    expect(res.headers()['set-cookie']).toContain(`gcal_oauth_state=${state.split('.')[0]}`);
    expect(res.headers()['set-cookie']).toContain('HttpOnly');
  });

  test('毎回違うstate（CSRF対策）になる', async ({ as }) => {
    const c = await as('admin');
    const get = async () => new URL((await c.get(`/api/calendar/google/auth?mailboxId=${MAILBOX_ID}`, { maxRedirects: 0 })).headers()['location']).searchParams.get('state');
    expect(await get()).not.toBe(await get());
  });

  test('閲覧のみの田中・権限のない鈴木・メールボックス未指定は403', async ({ as }) => {
    expect((await (await as('tanaka')).get(`/api/calendar/google/auth?mailboxId=${MAILBOX_ID}`, { maxRedirects: 0 })).status()).toBe(403);
    expect((await (await as('suzuki')).get(`/api/calendar/google/auth?mailboxId=${MAILBOX_ID}`, { maxRedirects: 0 })).status()).toBe(403);
    expect((await (await as('admin')).get('/api/calendar/google/auth', { maxRedirects: 0 })).status()).toBe(403);
  });

  test('戻りのstateがCookieと一致しないと、連携は作られずエラーで戻る', async ({ as }) => {
    const before = await db.calendar_google_links.count();
    const res = await (await as('admin')).get(`/api/calendar/google/callback?code=abc&state=forged.${MAILBOX_ID}`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('google_error=invalid_state');
    expect(await db.calendar_google_links.count()).toBe(before);
  });

  test('ユーザーが認可を拒否した場合も連携は作られない', async ({ as }) => {
    const c = await as('admin');
    const start = await c.get(`/api/calendar/google/auth?mailboxId=${MAILBOX_ID}`, { maxRedirects: 0 });
    const state = new URL(start.headers()['location']).searchParams.get('state')!;
    const res = await c.get(`/api/calendar/google/callback?error=access_denied&state=${state}`, { maxRedirects: 0 });
    expect(res.headers()['location']).toContain('google_error=access_denied');
  });

  test('未ログインで戻りのURLを開くとログイン画面へ', async ({ anon }) => {
    const res = await anon.get('/api/calendar/google/callback?code=x&state=y.z', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/login');
  });
});

test.describe('カレンダー（日付の扱い）', () => {
  test('日本時間の23:30の予定は、その日の予定として表示される', async ({ browser }) => {
    await db.calendar_events.create({ data: { id: 'ev_late', mailbox_id: MAILBOX_ID, title: '深夜対応', source: 'local', start_at: todayAt('23:30'), end_at: new Date(todayAt('23:30').getTime() + 20 * 60_000) } });
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    await expect(aside(page).getByRole('button', { name: /深夜対応/ })).toContainText('23:30');
    await ctx.close();
  });

  test('複数日にまたがる予定は、期間中の各日に表示される', async ({ browser }) => {
    const start = todayAt('09:00');
    const end = new Date(start.getTime() + 2 * 86400_000);
    await db.calendar_events.create({ data: { id: 'ev_multi', mailbox_id: MAILBOX_ID, title: '3日間の研修', source: 'local', start_at: start, end_at: end } });
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await openCalendar(page);
    const cells = page.locator('main .grid-cols-7 button', { hasText: '3日間の研修' });
    const count = await cells.count();
    // within the visible 6-week grid the event spans up to 3 cells (fewer only if the range crosses the grid edge)
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

  test('一覧のAPIは指定期間の予定だけを返す', async ({ as }) => {
    const c = await as('admin');
    const farFrom = encodeURIComponent(new Date(Date.now() + 300 * 86400_000).toISOString());
    const farTo = encodeURIComponent(new Date(Date.now() + 301 * 86400_000).toISOString());
    expect((await (await c.get(`/api/calendar/events?mailboxId=${MAILBOX_ID}&from=${farFrom}&to=${farTo}`)).json()).items).toEqual([]);
    expect(addDays(today(), 0)).toBe(today());
  });
});

test.describe('取り込むGoogleカレンダーの選択', () => {
  test.use({ storageState: AUTH.sato });
  const unlinked = () => db.calendar_google_links.create({ data: { id: 'l_pick', mailbox_id: MAILBOX_ID, linked_by_user_id: USERS.sato.id, encrypted_token: 'x', name: '新しい連携' } });

  test('一覧が読めないときは、理由と直し方が出る。Calendar APIが無効ならそう教える。直ったら「もう一度読み込む」で選べる', async ({ page }) => {
    await unlinked();
    let answer: { status: number; body: object } = { status: 502, body: { error: 'api_disabled' } };
    await page.route('**/api/calendar/links/l_pick/calendars', route => route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) }));
    await page.goto(`/calendar?mailbox=${MAILBOX_ID}&link=l_pick`);   // coming back from Google opens the settings by itself
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
    await page.goto(`/calendar?mailbox=${MAILBOX_ID}&link=l_pick`);   // coming back from Google opens the settings by itself
    await expect(page.getByText('「カレンダーを表示」にチェックを入れて許可してください')).toBeVisible();
    await page.unroute('**/api/calendar/links/l_pick/calendars');
    await page.route('**/api/calendar/links/l_pick/calendars', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
    await page.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.getByText('読み取れるカレンダーがありません')).toBeVisible();
  });
});
