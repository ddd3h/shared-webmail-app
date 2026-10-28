import type { APIRequestContext } from '@playwright/test';
import { test, expect, uniq } from './fixtures';
import { AUTH, RATE_IDS as R, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { makeClaim, makeTrip } from './helpers/factories';
import { resetTrips } from './helpers/seed';
import { addDays, field, today } from './helpers/ui';

test.beforeEach(async () => {
  await resetTrips();
  // restore the rate master (some tests edit it)
  await db.trip_allowance_types.updateMany({ data: { is_active: true } });
  await db.trip_allowance_types.update({ where: { id: R.domestic }, data: { amount: 3000 } });
  await db.trip_allowance_types.deleteMany({ where: { id: { notIn: Object.values(R) } } });
});
test.afterEach(async () => { await db.users.updateMany({ where: { id: USERS.admin2.id }, data: { role: 'admin' } }); });

const body = (o: Record<string, unknown> = {}) => ({
  destination: '名古屋（A社 本社）', purpose: 'A社 システム導入の立ち会い', start_date: addDays(today(), 10), end_date: addDays(today(), 12),
  daily_type_id: R.domestic, addon_type_ids: [], ...o,
});
const postTrip = (c: APIRequestContext, o: Record<string, unknown> = {}) => c.post('/api/trips', { data: body(o) });
const lines = async (id: string) => (await db.trip_allowance_lines.findMany({ where: { trip_id: id }, orderBy: { sort: 'asc' } })).map(l => [l.name, l.quantity, l.amount]);

test.describe('日当・加算金の計算（API）', () => {
  const cases: { label: string; start: number; end: number; daily: string | null; addons: string[]; expected: [string, number, number][]; total: number }[] = [
    { label: '3日2泊・国内日当のみ', start: 10, end: 12, daily: R.domestic, addons: [], expected: [['国内出張日当', 3, 9000]], total: 9000 },
    { label: '日帰り・国内日当のみ', start: 10, end: 10, daily: R.domestic, addons: [], expected: [['国内出張日当', 1, 3000]], total: 3000 },
    { label: '日帰りに宿泊手当（1泊あたり）を付けても0円', start: 10, end: 10, daily: R.domestic, addons: [R.lodging], expected: [['国内出張日当', 1, 3000], ['宿泊手当', 0, 0]], total: 3000 },
    { label: '3日2泊・日当＋宿泊手当', start: 10, end: 12, daily: R.domestic, addons: [R.lodging], expected: [['国内出張日当', 3, 9000], ['宿泊手当', 2, 4000]], total: 13000 },
    { label: '3日2泊・加算金をすべて付ける', start: 10, end: 12, daily: R.domestic, addons: [R.onsite, R.resident, R.lodging, R.event], expected: [['国内出張日当', 3, 9000], ['現場作業手当', 3, 3000], ['客先常駐手当', 3, 6000], ['宿泊手当', 2, 4000], ['展示会・イベント対応手当', 1, 5000]], total: 27000 },
    { label: '海外日当は1日6,000円', start: 10, end: 14, daily: R.overseas, addons: [], expected: [['海外出張日当', 5, 30000]], total: 30000 },
    { label: '定額（1回あたり）は日数に関係しない', start: 10, end: 20, daily: null, addons: [R.event], expected: [['展示会・イベント対応手当', 1, 5000]], total: 5000 },
    { label: '日当なし・加算金のみ', start: 10, end: 11, daily: null, addons: [R.onsite], expected: [['現場作業手当', 2, 2000]], total: 2000 },
    { label: '手当を何も選ばない', start: 10, end: 11, daily: null, addons: [], expected: [], total: 0 },
    { label: '同じ加算金を重複して送っても1回だけ', start: 10, end: 10, daily: R.domestic, addons: [R.onsite, R.onsite], expected: [['国内出張日当', 1, 3000], ['現場作業手当', 1, 1000]], total: 4000 },
    { label: '30日の長期出張', start: 10, end: 39, daily: R.domestic, addons: [R.lodging], expected: [['国内出張日当', 30, 90000], ['宿泊手当', 29, 58000]], total: 148000 },
  ];
  for (const c of cases) {
    test(`${c.label}`, async ({ as }) => {
      const res = await postTrip(await as('sato'), { start_date: addDays(today(), c.start), end_date: addDays(today(), c.end), daily_type_id: c.daily, addon_type_ids: c.addons });
      expect(res.status()).toBe(201);
      const id = (await res.json()).id;
      expect(await lines(id)).toEqual(c.expected);
      const listed = (await (await (await as('sato')).get('/api/trips')).json()).items.find((t: { id: string }) => t.id === id);
      expect(listed.allowance_total).toBe(c.total);
    });
  }

  for (const [label, start, end, expected] of [
    ['月またぎ（10/30〜11/2）は4日3泊', '2031-10-30', '2031-11-02', [4, 3]],
    ['年またぎ（12/30〜1/2）は4日3泊', '2031-12-30', '2032-01-02', [4, 3]],
    ['うるう日をまたぐ（2/28〜3/1）は3日2泊', '2032-02-28', '2032-03-01', [3, 2]],
    ['うるう年でない年（2/28〜3/1）は2日1泊', '2031-02-28', '2031-03-01', [2, 1]],
  ] as const) {
    test(`日数の数え方: ${label}`, async ({ as }) => {
      const res = await postTrip(await as('sato'), { start_date: start, end_date: end, daily_type_id: R.domestic, addon_type_ids: [R.lodging] });
      expect(res.status()).toBe(201);
      const t = (await (await (await as('sato')).get('/api/trips')).json()).items.find((x: { id: string }) => x.id === (res as any)._id) ?? null;
      const items = (await (await (await as('sato')).get('/api/trips')).json()).items;
      const mine = items.find((x: { start_date: string }) => x.start_date === start);
      expect([mine.days, mine.nights]).toEqual(expected);
      expect(t === null || t.days === expected[0]).toBe(true);
    });
  }

  test('期間は90日まで。91日は400', async ({ as }) => {
    const c = await as('sato');
    expect((await postTrip(c, { start_date: '2032-01-01', end_date: '2032-03-30' })).status()).toBe(201); // 90 days
    expect((await postTrip(c, { start_date: '2033-01-01', end_date: '2033-03-32'.replace('32', '31') })).status()).toBe(201);
    expect((await postTrip(c, { start_date: '2034-01-01', end_date: '2034-04-02' })).status()).toBe(400); // 92 days
  });

  test('手当を変更しても、すでに申請した出張の金額は変わらない（申請時点で確定）', async ({ as }) => {
    const id = (await (await postTrip(await as('sato'))).json()).id;
    await (await as('admin')).put(`/api/trips/allowance-types/${R.domestic}`, { data: { name: '国内出張日当', kind: 'daily', unit: 'per_day', amount: 9999 } });
    expect(await lines(id)).toEqual([['国内出張日当', 3, 9000]]);
    const next = (await (await postTrip(await as('sato'), { start_date: addDays(today(), 30), end_date: addDays(today(), 30) })).json()).id;
    expect(await lines(next)).toEqual([['国内出張日当', 1, 9999]]);
  });
});

test.describe('出張申請の入力検証（API）', () => {
  for (const [label, patch] of [
    ['出張先が空', { destination: '  ' }],
    ['出張先が201文字', { destination: 'あ'.repeat(201) }],
    ['業務内容が空', { purpose: '' }],
    ['業務内容が2001文字', { purpose: 'a'.repeat(2001) }],
    ['終了日が開始日より前', { start_date: addDays(today(), 5), end_date: addDays(today(), 4) }],
    ['日付が不正', { start_date: '2026-02-30' }],
    ['日付の形式が不正', { end_date: '10/30' }],
    ['存在しない手当', { daily_type_id: 'nope' }],
    ['日当の欄に加算金を指定', { daily_type_id: R.onsite }],
    ['加算金の欄に日当を指定', { daily_type_id: null, addon_type_ids: [R.domestic] }],
    ['日当を2つ（日当＋加算金欄の日当）', { addon_type_ids: [R.overseas] }],
    ['加算金が31件', { addon_type_ids: Array.from({ length: 31 }, (_, i) => `x${i}`) }],
  ] as const) {
    test(`申請: ${label} は400`, async ({ as }) => {
      expect((await postTrip(await as('sato'), patch)).status()).toBe(400);
      expect(await db.business_trips.count()).toBe(0);
    });
  }

  test('無効にした手当は選べない（400）', async ({ as }) => {
    await db.trip_allowance_types.update({ where: { id: R.onsite }, data: { is_active: false } });
    expect((await postTrip(await as('sato'), { addon_type_ids: [R.onsite] })).status()).toBe(400);
  });

  test('自分の別の出張と期間が重なると409（境界の日も重なる）。別の人とは重なってよい', async ({ as }) => {
    const c = await as('sato');
    expect((await postTrip(c, { start_date: addDays(today(), 10), end_date: addDays(today(), 12) })).status()).toBe(201);
    for (const [s, e] of [[10, 12], [11, 11], [12, 14], [8, 10], [5, 20]] as const) {
      const res = await postTrip(c, { start_date: addDays(today(), s), end_date: addDays(today(), e) });
      expect(res.status(), `${s}-${e}`).toBe(409);
      expect((await res.json()).error).toBe('overlap');
    }
    expect((await postTrip(c, { start_date: addDays(today(), 13), end_date: addDays(today(), 14) })).status()).toBe(201);
    expect((await postTrip(c, { start_date: addDays(today(), 8), end_date: addDays(today(), 9) })).status()).toBe(201);
    expect((await postTrip(await as('tanaka'), { start_date: addDays(today(), 10), end_date: addDays(today(), 12) })).status()).toBe(201);
  });

  test('却下・取消された出張とは期間が重なってもよい', async ({ as }) => {
    await makeTrip({ role: 'sato', status: 'rejected', start: addDays(today(), 10), end: addDays(today(), 12) });
    await makeTrip({ role: 'sato', status: 'cancelled', start: addDays(today(), 10), end: addDays(today(), 12) });
    expect((await postTrip(await as('sato'))).status()).toBe(201);
  });

  test('手当なしの申請もできる。役員・業務委託・管理者も申請できる', async ({ as }) => {
    expect((await postTrip(await as('sato'), { daily_type_id: null })).status()).toBe(201);
    for (const role of ['yamada', 'suzuki', 'admin'] as const) expect((await postTrip(await as(role))).status()).toBe(201);
  });

  test('過去の日付でも申請できる（事後申請）', async ({ as }) => {
    expect((await postTrip(await as('sato'), { start_date: addDays(today(), -5), end_date: addDays(today(), -4) })).status()).toBe(201);
  });
});

test.describe('出張の承認フロー（API）', () => {
  const review = (c: APIRequestContext, id: string, data: object) => c.post(`/api/trips/${id}/review`, { data });
  const mk = async (as: (r: any) => Promise<APIRequestContext>, role: 'sato' | 'admin' = 'sato') => (await (await postTrip(await as(role))).json()).id as string;

  test('申請 → 承認で approved になり、承認者が記録される', async ({ as }) => {
    const id = await mk(as);
    expect((await review(await as('admin'), id, { action: 'approve' })).status()).toBe(200);
    expect(await db.business_trips.findUnique({ where: { id } })).toMatchObject({ status: 'approved', reviewed_by_id: USERS.admin.id });
    expect(await db.audit_logs.count({ where: { action_type: 'trip_approve', target_id: id } })).toBe(1);
  });

  test('管理者以外は承認できない', async ({ as }) => {
    const id = await mk(as);
    expect((await review(await as('sato'), id, { action: 'approve' })).status()).toBe(403);
    expect((await review(await as('tanaka'), id, { action: 'reject', comment: 'x' })).status()).toBe(403);
  });

  test('却下はコメント必須で、却下後は本人が修正して再申請できる', async ({ as }) => {
    const id = await mk(as);
    expect((await review(await as('admin'), id, { action: 'reject' })).status()).toBe(400);
    expect((await review(await as('admin'), id, { action: 'reject', comment: '日程を調整してください' })).status()).toBe(200);
    expect(await db.business_trips.findUnique({ where: { id } })).toMatchObject({ status: 'rejected', review_comment: '日程を調整してください' });
    const edit = await (await as('sato')).patch(`/api/trips/${id}`, { data: body({ start_date: addDays(today(), 20), end_date: addDays(today(), 21) }) });
    expect(edit.status()).toBe(200);
    expect(await db.business_trips.findUnique({ where: { id } })).toMatchObject({ status: 'pending', review_comment: null, reviewed_by_id: null });
    expect(await lines(id)).toEqual([['国内出張日当', 2, 6000]]);
  });

  test('処理済みの出張は再承認できない（409）。存在しない出張は404。不正なactionは400', async ({ as }) => {
    const id = await mk(as);
    const admin = await as('admin');
    await review(admin, id, { action: 'approve' });
    expect((await review(admin, id, { action: 'approve' })).status()).toBe(409);
    expect((await review(admin, 'nope', { action: 'approve' })).status()).toBe(404);
    expect((await review(admin, id, { action: 'later' })).status()).toBe(400);
  });

  test('管理者が複数いると、自分の出張は他の管理者が承認する', async ({ as }) => {
    const id = await mk(as, 'admin');
    expect((await review(await as('admin'), id, { action: 'approve' })).status()).toBe(403);
    expect((await review(await as('admin2'), id, { action: 'approve' })).status()).toBe(200);
  });

  test('管理者が1人だけなら自分の出張を承認できる', async ({ as }) => {
    await db.users.update({ where: { id: USERS.admin2.id }, data: { role: 'user' } });
    const id = await mk(as, 'admin');
    expect((await review(await as('admin'), id, { action: 'approve' })).status()).toBe(200);
  });

  test('承認済みの出張は本人が取り消せるが、取消済みは再び取り消せない', async ({ as }) => {
    const id = await mk(as);
    await review(await as('admin'), id, { action: 'approve' });
    expect((await (await as('sato')).post(`/api/trips/${id}/cancel`)).status()).toBe(200);
    expect(await db.business_trips.findUnique({ where: { id } })).toMatchObject({ status: 'cancelled' });
    expect((await (await as('sato')).post(`/api/trips/${id}/cancel`)).status()).toBe(409);
  });

  test('取消できるのは本人か管理者だけ。承認前の出張は取消ではなく取り下げ', async ({ as }) => {
    const id = await mk(as);
    expect((await (await as('sato')).post(`/api/trips/${id}/cancel`)).status()).toBe(409);
    await review(await as('admin'), id, { action: 'approve' });
    expect((await (await as('tanaka')).post(`/api/trips/${id}/cancel`)).status()).toBe(403);
    expect((await (await as('admin')).post(`/api/trips/${id}/cancel`)).status()).toBe(200);
  });

  test('取消すると、同じ期間に新しく申請できる', async ({ as }) => {
    const id = await mk(as);
    await review(await as('admin'), id, { action: 'approve' });
    expect((await postTrip(await as('sato'))).status()).toBe(409);
    await (await as('sato')).post(`/api/trips/${id}/cancel`);
    expect((await postTrip(await as('sato'))).status()).toBe(201);
  });

  test('承認待ち・却下の出張は本人が取り下げられるが、承認済みはできない', async ({ as }) => {
    const pending = await mk(as);
    expect((await (await as('sato')).delete(`/api/trips/${pending}`)).status()).toBe(200);
    const approved = await makeTrip({ role: 'sato', status: 'approved' });
    expect((await (await as('sato')).delete(`/api/trips/${approved.id}`)).status()).toBe(409);
    expect((await (await as('tanaka')).delete(`/api/trips/${approved.id}`)).status()).toBe(403);
  });
});

test.describe('出張の編集と手当の調整（API）', () => {
  test('本人は承認待ちの間だけ編集でき、承認済みは編集できない（409）', async ({ as }) => {
    const pending = await makeTrip({ role: 'sato', status: 'pending' });
    expect((await (await as('sato')).patch(`/api/trips/${pending.id}`, { data: body() })).status()).toBe(200);
    const approved = await makeTrip({ role: 'sato', status: 'approved', start: addDays(today(), 50), end: addDays(today(), 51) });
    expect((await (await as('sato')).patch(`/api/trips/${approved.id}`, { data: body() })).status()).toBe(409);
  });

  test('他人の出張は編集できない（403）', async ({ as }) => {
    const t = await makeTrip({ role: 'sato', status: 'pending' });
    expect((await (await as('tanaka')).patch(`/api/trips/${t.id}`, { data: body() })).status()).toBe(403);
  });

  test('編集で他の出張と重なると409', async ({ as }) => {
    await makeTrip({ role: 'sato', status: 'approved', start: addDays(today(), 10), end: addDays(today(), 12) });
    const other = await makeTrip({ role: 'sato', status: 'pending', start: addDays(today(), 30), end: addDays(today(), 30) });
    const res = await (await as('sato')).patch(`/api/trips/${other.id}`, { data: body() });
    expect(res.status()).toBe(409);
  });

  test('自分自身の期間への編集は重複とみなされない', async ({ as }) => {
    const t = await makeTrip({ role: 'sato', status: 'pending', start: addDays(today(), 10), end: addDays(today(), 12) });
    expect((await (await as('sato')).patch(`/api/trips/${t.id}`, { data: body({ start_date: addDays(today(), 11) }) })).status()).toBe(200);
  });

  test('管理者は承認済みの出張の手当だけを調整でき、日付や行き先は変わらない', async ({ as }) => {
    const t = await makeTrip({ role: 'sato', status: 'approved', destination: '大阪', start: addDays(today(), 10), end: addDays(today(), 12) });
    const res = await (await as('admin')).patch(`/api/trips/${t.id}`, { data: { destination: '改ざん', start_date: '2020-01-01', end_date: '2020-01-02', daily_type_id: R.overseas, addon_type_ids: [R.event] } });
    expect(res.status()).toBe(200);
    const row = await db.business_trips.findUnique({ where: { id: t.id } });
    expect(row!.destination).toBe('大阪');
    expect(row!.start_date.toISOString().slice(0, 10)).toBe(addDays(today(), 10));
    expect(await lines(t.id)).toEqual([['海外出張日当', 3, 18000], ['展示会・イベント対応手当', 1, 5000]]);
    expect(await db.audit_logs.count({ where: { action_type: 'trip_allowance_adjust', target_id: t.id } })).toBe(1);
  });

  test('取消済み・却下の出張は管理者でも手当を調整できない', async ({ as }) => {
    for (const status of ['cancelled', 'rejected'] as const) {
      const t = await makeTrip({ role: 'sato', status, start: addDays(today(), 60), end: addDays(today(), 60) });
      expect((await (await as('admin')).patch(`/api/trips/${t.id}`, { data: { daily_type_id: R.overseas, addon_type_ids: [] } })).status()).toBe(409);
    }
  });

  test('調整で日当を2つ選ぶと400', async ({ as }) => {
    const t = await makeTrip({ role: 'sato', status: 'pending' });
    expect((await (await as('admin')).patch(`/api/trips/${t.id}`, { data: { daily_type_id: R.domestic, addon_type_ids: [R.overseas] } })).status()).toBe(400);
  });
});

test.describe('出張の一覧（API・権限）', () => {
  test('一般ユーザーは scope=all が403。userId を指定しても自分の分だけ', async ({ as }) => {
    await makeTrip({ role: 'tanaka', destination: '田中の出張' });
    await makeTrip({ role: 'sato', destination: '佐藤の出張', start: addDays(today(), 40) });
    const c = await as('sato');
    expect((await c.get('/api/trips?scope=all')).status()).toBe(403);
    const items = (await (await c.get(`/api/trips?userId=${USERS.tanaka.id}`)).json()).items;
    expect(items.map((t: { destination: string }) => t.destination)).toEqual(['佐藤の出張']);
  });

  test('管理者は全員分を状態で絞り込める。承認待ちの件数も返る', async ({ as }) => {
    await makeTrip({ role: 'tanaka', status: 'pending' });
    await makeTrip({ role: 'sato', status: 'approved', start: addDays(today(), 40) });
    const admin = await as('admin');
    const all = await (await admin.get('/api/trips?scope=all')).json();
    expect(all.items).toHaveLength(2);
    expect(all.pending_count).toBe(1);
    expect((await (await admin.get('/api/trips?scope=all&status=approved')).json()).items).toHaveLength(1);
    expect((await admin.get('/api/trips?scope=all&status=weird')).status()).toBe(400);
  });

  test('詳細には、紐付いた経費の一覧と、手当＋経費の合計に使う値が入る', async ({ as }) => {
    const t = await makeTrip({ role: 'sato', status: 'approved' });
    await db.trip_allowance_lines.create({ data: { trip_id: t.id, type_id: R.domestic, name: '国内出張日当', kind: 'daily', unit: 'per_day', rate: 3000, quantity: 1, amount: 3000 } });
    await makeClaim({ role: 'sato', tripId: t.id, amount: 22600, title: '新幹線代' });
    await makeClaim({ role: 'sato', tripId: t.id, amount: 1400, title: 'タクシー', method: 'company' });
    const item = (await (await (await as('sato')).get('/api/trips')).json()).items[0];
    expect(item).toMatchObject({ allowance_total: 3000, expenses_total: 24000 });
    expect(item.expenses.map((e: { title: string }) => e.title)).toEqual(expect.arrayContaining(['新幹線代', 'タクシー']));
  });
});

test.describe('出張申請（画面）', () => {
  test.use({ storageState: AUTH.sato });

  async function openForm(page: import('@playwright/test').Page) {
    await page.goto('/trips');
    await page.getByRole('button', { name: '＋ 出張を申請' }).click();
    await expect(page.getByText('業務内容・目的')).toBeVisible();
  }

  test('日付と手当を選ぶと、計算結果がその場で表示される', async ({ page }) => {
    await openForm(page);
    const dates = page.locator('input[type=date]');
    await dates.nth(0).fill(addDays(today(), 10));
    await dates.nth(1).fill(addDays(today(), 12));
    await expect(page.getByText('計算結果（3日・2泊）')).toBeVisible();
    await page.getByRole('radio', { name: /国内出張日当/ }).check();
    await page.getByRole('checkbox', { name: /宿泊手当/ }).check();
    const table = page.locator('div.rounded-lg.border', { hasText: '手当合計' }).last();
    await expect(table).toContainText('国内出張日当');
    await expect(table).toContainText('¥3,000 × 3日');
    await expect(table).toContainText('¥2,000 × 2泊');
    await expect(table.getByText('手当合計').locator('..')).toContainText('¥13,000');
    await page.getByRole('checkbox', { name: /展示会/ }).check();
    await expect(table.getByText('手当合計').locator('..')).toContainText('¥18,000');
    await page.getByRole('checkbox', { name: /宿泊手当/ }).uncheck();
    await expect(table.getByText('手当合計').locator('..')).toContainText('¥14,000');
  });

  test('日当を「なし」にすると、日当の行が消える', async ({ page }) => {
    await openForm(page);
    const dates = page.locator('input[type=date]');
    await dates.nth(0).fill(addDays(today(), 10));
    await dates.nth(1).fill(addDays(today(), 10));
    await page.getByRole('radio', { name: /日当なし/ }).check();
    await expect(page.getByRole('radio', { name: /国内出張日当/ })).toBeVisible(); // 選択肢としては残る
    await expect(page.getByText('手当の指定はありません')).toBeVisible();
    await expect(page.getByText('手当合計')).toHaveCount(0);
    await page.getByRole('checkbox', { name: /現場作業手当/ }).check();
    await expect(page.getByText('手当合計').locator('..')).toContainText('¥1,000');
  });

  test('期間が未入力のときは「期間を入力すると計算されます」', async ({ page }) => {
    await openForm(page);
    await expect(page.getByText('期間を入力すると計算されます')).toBeVisible();
  });

  test('出発日が過ぎていると事後申請の注意が出る', async ({ page }) => {
    await openForm(page);
    await page.locator('input[type=date]').nth(0).fill(addDays(today(), -3));
    await expect(page.getByText('出発日が過ぎています（事後申請になります）')).toBeVisible();
  });

  test('出発日を帰着日より後にすると、帰着日が自動で追従する', async ({ page }) => {
    await openForm(page);
    const dates = page.locator('input[type=date]');
    await dates.nth(0).fill(addDays(today(), 5));
    await dates.nth(1).fill(addDays(today(), 6));
    await dates.nth(0).fill(addDays(today(), 9));
    await expect(dates.nth(1)).toHaveValue(addDays(today(), 9));
  });

  test('必須項目が空のあいだは「申請する」が押せない', async ({ page }) => {
    await openForm(page);
    await expect(page.getByRole('button', { name: '申請する' })).toBeDisabled();
  });

  test('申請すると承認待ちの出張として一覧に出る', async ({ page }) => {
    await openForm(page);
    await page.getByPlaceholder(/名古屋/).fill('大阪（B社 展示会会場）');
    const dates = page.locator('input[type=date]');
    await dates.nth(0).fill(addDays(today(), 20));
    await dates.nth(1).fill(addDays(today(), 22));
    await page.locator('textarea').fill('B社主催の展示会での製品デモ対応');
    await page.getByRole('radio', { name: /国内出張日当/ }).check();
    await page.getByRole('checkbox', { name: /展示会/ }).check();
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('出張を申請しました')).toBeVisible();
    const card = page.getByRole('button', { name: /大阪（B社 展示会会場）/ });
    await expect(card).toContainText('承認待ち');
    await expect(card).toContainText('¥14,000');
    await expect(card).toContainText('3日（2泊）');
  });

  test('重なる期間で申請すると、重複のエラーが画面に出る', async ({ page }) => {
    await makeTrip({ role: 'sato', status: 'approved', destination: '既存の出張', start: addDays(today(), 10), end: addDays(today(), 12) });
    await openForm(page);
    await page.getByPlaceholder(/名古屋/).fill('重複の出張');
    const dates = page.locator('input[type=date]');
    await dates.nth(0).fill(addDays(today(), 11));
    await dates.nth(1).fill(addDays(today(), 13));
    await page.locator('textarea').fill('x');
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('その期間は、すでに申請している別の出張と重なっています')).toBeVisible();
  });

  test('承認済みの出張: 詳細に手当・経費・合計が出て、「この出張の経費を申請」リンクがある', async ({ page }) => {
    const t = await makeTrip({ role: 'sato', status: 'approved', destination: '福岡' });
    await db.trip_allowance_lines.create({ data: { trip_id: t.id, type_id: R.domestic, name: '国内出張日当', kind: 'daily', unit: 'per_day', rate: 3000, quantity: 1, amount: 3000 } });
    await makeClaim({ role: 'sato', tripId: t.id, amount: 22600, title: '新幹線代（福岡）' });
    await page.goto('/trips');
    await page.getByRole('button', { name: /福岡/ }).click();
    await expect(page.getByText('業務内容', { exact: true })).toBeVisible();
    await expect(page.getByText('手当合計').locator('..')).toContainText('¥3,000');
    await expect(page.getByText('新幹線代（福岡）')).toBeVisible();
    await expect(page.getByText('経費合計').locator('..')).toContainText('¥22,600');
    await expect(page.getByText('出張費の合計（手当＋経費）').locator('..')).toContainText('¥25,600');
    await expect(page.getByRole('link', { name: '＋ この出張の経費を申請' })).toHaveAttribute('href', `/expenses?trip=${t.id}`);
  });

  test('承認待ちは編集・取り下げ、承認済みは「出張を取り消す」だけが出る', async ({ page }) => {
    await makeTrip({ role: 'sato', status: 'pending', destination: '待ちの出張', start: addDays(today(), 10) });
    await makeTrip({ role: 'sato', status: 'approved', destination: '済みの出張', start: addDays(today(), 30) });
    await page.goto('/trips');
    await page.getByRole('button', { name: /待ちの出張/ }).click();
    await expect(page.getByRole('button', { name: '編集', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '取り下げ' })).toBeVisible();
    await expect(page.getByRole('button', { name: '出張を取り消す' })).toHaveCount(0);
    await page.getByRole('button', { name: /済みの出張/ }).click();
    await expect(page.getByRole('button', { name: '出張を取り消す' })).toBeVisible();
  });

  test('出張を取り消すと「取消」になる', async ({ page }) => {
    const t = await makeTrip({ role: 'sato', status: 'approved', destination: '取り消す出張' });
    await page.goto('/trips');
    await page.getByRole('button', { name: /取り消す出張/ }).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '出張を取り消す' }).click();
    await expect(page.getByText('出張を取り消しました')).toBeVisible();
    await expect(page.getByRole('button', { name: /取り消す出張/ })).toContainText('取消');
    expect((await db.business_trips.findUnique({ where: { id: t.id } }))!.status).toBe('cancelled');
  });

  test('却下の理由が見え、修正して再申請できる', async ({ page }) => {
    const t = await makeTrip({ role: 'sato', status: 'rejected', destination: '却下された出張', comment: '日程を調整してください' });
    await page.goto('/trips');
    await page.getByRole('button', { name: /却下された出張/ }).click();
    await expect(page.getByText('日程を調整してください')).toBeVisible();
    await page.getByRole('button', { name: '修正して再申請' }).click();
    await page.getByRole('button', { name: '再申請する' }).click();
    await expect(page.getByText('再申請しました')).toBeVisible();
    expect((await db.business_trips.findUnique({ where: { id: t.id } }))!.status).toBe('pending');
  });

  test('状態の絞り込み', async ({ page }) => {
    await makeTrip({ role: 'sato', status: 'pending', destination: '出張P', start: addDays(today(), 10) });
    await makeTrip({ role: 'sato', status: 'approved', destination: '出張A', start: addDays(today(), 30) });
    await makeTrip({ role: 'sato', status: 'rejected', destination: '出張R', start: addDays(today(), 50) });
    await page.goto('/trips');
    await page.getByRole('button', { name: '承認待ち', exact: true }).click();
    await expect(page.getByRole('button', { name: /出張P/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /出張A/ })).toHaveCount(0);
    await page.getByRole('button', { name: '却下', exact: true }).click();
    await expect(page.getByRole('button', { name: /出張R/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /出張P/ })).toHaveCount(0);
  });

  test('一般ユーザーには「承認」「手当の設定」タブが出ない', async ({ page }) => {
    await page.goto('/trips');
    await expect(page.getByRole('button', { name: '自分の出張' })).toBeVisible();
    await expect(page.getByRole('button', { name: '承認', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '手当の設定' })).toHaveCount(0);
  });
});

test.describe('出張の承認・手当の設定（管理者の画面）', () => {
  test.use({ storageState: AUTH.admin });

  test('承認待ちが開いた状態で並び、承認できる', async ({ page }) => {
    const t = await makeTrip({ role: 'sato', status: 'pending', destination: '承認する出張' });
    await db.trip_allowance_lines.create({ data: { trip_id: t.id, type_id: R.domestic, name: '国内出張日当', kind: 'daily', unit: 'per_day', rate: 3000, quantity: 1, amount: 3000 } });
    await page.goto('/trips');
    await page.getByRole('button', { name: '承認', exact: true }).click();
    await expect(page.getByText('承認待ちの出張').locator('..')).toContainText('1件');
    const card = page.locator('div.rounded-xl', { hasText: '承認する出張' });
    await expect(card).toContainText('国内出張日当');
    await card.getByRole('button', { name: '承認', exact: true }).click();
    await expect(page.getByText('承認しました')).toBeVisible();
    expect((await db.business_trips.findUnique({ where: { id: t.id } }))!.status).toBe('approved');
  });

  test('却下は理由が必要で、入力するまで押せない', async ({ page }) => {
    const t = await makeTrip({ role: 'sato', status: 'pending', destination: '却下する出張' });
    await page.goto('/trips');
    await page.getByRole('button', { name: '承認', exact: true }).click();
    await page.locator('div.rounded-xl', { hasText: '却下する出張' }).getByRole('button', { name: '却下…' }).click();
    const dialog = page.locator('div.fixed');
    await expect(dialog.getByRole('button', { name: '却下する', exact: true })).toBeDisabled();
    await dialog.locator('textarea').fill('日程を調整してください');
    await dialog.getByRole('button', { name: '却下する', exact: true }).click();
    await expect(page.getByText('却下しました')).toBeVisible();
    expect(await db.business_trips.findUnique({ where: { id: t.id } })).toMatchObject({ status: 'rejected', review_comment: '日程を調整してください' });
  });

  test('「手当を調整」で加算金を足すと、手当が再計算される', async ({ page }) => {
    const t = await makeTrip({ role: 'sato', status: 'pending', destination: '調整する出張', start: addDays(today(), 10), end: addDays(today(), 12) });
    await page.goto('/trips');
    await page.getByRole('button', { name: '承認', exact: true }).click();
    await page.locator('div.rounded-xl', { hasText: '調整する出張' }).getByRole('button', { name: '手当を調整' }).click();
    await expect(page.getByText('日付や行き先は変更できません')).toBeVisible();
    await page.getByRole('radio', { name: /国内出張日当/ }).check();
    await page.getByRole('checkbox', { name: /客先常駐手当/ }).check();
    await page.getByRole('button', { name: '手当を更新' }).click();
    await expect(page.getByText('手当を更新しました')).toBeVisible();
    expect(await lines(t.id)).toEqual([['国内出張日当', 3, 9000], ['客先常駐手当', 3, 6000]]);
  });

  test('手当の設定: 一覧にサンプルの手当が並び、種類と単位が表示される', async ({ page }) => {
    await page.goto('/trips');
    await page.getByRole('button', { name: '手当の設定' }).click();
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({ hasText: '国内出張日当' })).toContainText('日当');
    await expect(rows.filter({ hasText: '国内出張日当' })).toContainText('¥3,000');
    await expect(rows.filter({ hasText: '宿泊手当' })).toContainText('1泊あたり');
    await expect(rows.filter({ hasText: '展示会' })).toContainText('1回あたり');
  });

  test('手当の設定: 新しい加算金を追加すると、申請画面で選べる', async ({ page, as }) => {
    await page.goto('/trips');
    await page.getByRole('button', { name: '手当の設定' }).click();
    await page.getByRole('button', { name: '＋ 手当を追加' }).click();
    await field(page, '名称').fill('深夜作業手当');
    await field(page, '金額').fill('1500');
    await field(page, '説明').fill('22時以降の作業');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: '深夜作業手当' })).toContainText('¥1,500');
    const names = (await (await (await as('sato')).get('/api/trips/allowance-types')).json()).items.map((i: { name: string }) => i.name);
    expect(names).toContain('深夜作業手当');
  });

  test('手当の設定: 金額を変更すると、新しい申請から新金額で計算される', async ({ page, as }) => {
    await page.goto('/trips');
    await page.getByRole('button', { name: '手当の設定' }).click();
    await page.locator('tbody tr', { hasText: '国内出張日当' }).getByRole('button', { name: '編集' }).click();
    await field(page, '金額').fill('3500');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    const id = (await (await postTrip(await as('sato'), { start_date: addDays(today(), 70), end_date: addDays(today(), 70) })).json()).id;
    expect(await lines(id)).toEqual([['国内出張日当', 1, 3500]]);
  });

  test('手当の設定: 「申請画面で選べるようにする」を外すと選べなくなる', async ({ page, as }) => {
    await page.goto('/trips');
    await page.getByRole('button', { name: '手当の設定' }).click();
    await page.locator('tbody tr', { hasText: '現場作業手当' }).getByRole('button', { name: '編集' }).click();
    await page.getByLabel('申請画面で選べるようにする').uncheck();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('tbody tr', { hasText: '現場作業手当' })).toContainText('無効');
    const names = (await (await (await as('sato')).get('/api/trips/allowance-types')).json()).items.map((i: { name: string }) => i.name);
    expect(names).not.toContain('現場作業手当');
  });
});

test.describe('手当マスタ（API）', () => {
  const type = (o: object = {}) => ({ name: uniq('tmp手当'), kind: 'addon', unit: 'per_day', amount: 500, ...o });

  test('一覧は誰でも見られる（有効なものだけ）。管理者は ?all=1 で無効なものも見られる', async ({ as }) => {
    await db.trip_allowance_types.update({ where: { id: R.event }, data: { is_active: false } });
    const user = (await (await (await as('tanaka')).get('/api/trips/allowance-types?all=1')).json()).items;
    expect(user).toHaveLength(5);
    expect((await (await (await as('admin')).get('/api/trips/allowance-types?all=1')).json()).items).toHaveLength(6);
  });

  test('管理者以外は追加・変更・削除できない（403）', async ({ as }) => {
    const c = await as('sato');
    expect((await c.post('/api/trips/allowance-types', { data: type() })).status()).toBe(403);
    expect((await c.put(`/api/trips/allowance-types/${R.domestic}`, { data: type() })).status()).toBe(403);
    expect((await c.delete(`/api/trips/allowance-types/${R.domestic}`)).status()).toBe(403);
  });

  for (const [label, patch] of [
    ['名称が空', { name: ' ' }],
    ['種類が不正', { kind: 'bonus' }],
    ['単位が不正', { unit: 'per_hour' }],
    ['金額が負', { amount: -1 }],
    ['金額が小数', { amount: 1.5 }],
    ['金額が1000万円超', { amount: 10_000_001 }],
    ['説明が301文字', { description: 'あ'.repeat(301) }],
  ] as const) {
    test(`追加: ${label} は400`, async ({ as }) => {
      expect((await (await as('admin')).post('/api/trips/allowance-types', { data: type(patch) })).status()).toBe(400);
    });
  }

  test('金額0円の手当は登録できる', async ({ as }) => {
    expect((await (await as('admin')).post('/api/trips/allowance-types', { data: type({ amount: 0 }) })).status()).toBe(201);
  });

  test('使用済みの手当は削除ではなく無効になり、未使用なら削除される', async ({ as }) => {
    const admin = await as('admin');
    const trip = await (await postTrip(await as('sato'), { addon_type_ids: [R.onsite] })).json();
    expect(trip.id).toBeTruthy();
    const used = await (await admin.delete(`/api/trips/allowance-types/${R.onsite}`)).json();
    expect(used.deactivated).toBe(true);
    expect((await db.trip_allowance_types.findUnique({ where: { id: R.onsite } }))!.is_active).toBe(false);
    const created = await (await admin.post('/api/trips/allowance-types', { data: type() })).json();
    const unused = await (await admin.delete(`/api/trips/allowance-types/${created.id}`)).json();
    expect(unused.deactivated).toBe(false);
    expect(await db.trip_allowance_types.findUnique({ where: { id: created.id } })).toBeNull();
  });

  test('存在しない手当の変更・削除は404', async ({ as }) => {
    const admin = await as('admin');
    expect((await admin.put('/api/trips/allowance-types/nope', { data: type() })).status()).toBe(404);
    expect((await admin.delete('/api/trips/allowance-types/nope')).status()).toBe(404);
  });

  test('追加・変更は監査ログに残る', async ({ as }) => {
    const admin = await as('admin');
    const id = (await (await admin.post('/api/trips/allowance-types', { data: type() })).json()).id;
    await admin.put(`/api/trips/allowance-types/${id}`, { data: type({ amount: 800 }) });
    expect(await db.audit_logs.count({ where: { action_type: { in: ['trip_allowance_type_create', 'trip_allowance_type_update'] }, target_id: id } })).toBe(2);
  });
});
