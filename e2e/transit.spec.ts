import { test, expect, uniq } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';
import { resetExpenses } from './helpers/seed';
import { field, today } from './helpers/ui';

test.describe.configure({ mode: 'serial' });

const KEY = 'e2e-maps-key';
const setKey = (value: string) => db.app_settings.upsert({ where: { key: 'GOOGLE_MAPS_API_KEY' }, create: { key: 'GOOGLE_MAPS_API_KEY', value, is_secret: true }, update: { value, is_secret: true } });
const settle = () => new Promise(r => setTimeout(r, 300));
// a place the stand-in has not been asked about in this run: results are remembered for a while
const place = (name: string) => `${name}${uniq('')}`;

test.beforeEach(async () => {
  await resetExpenses();
  await db.app_settings.deleteMany({ where: { key: { in: ['ROUTE_PROVIDER', 'OSRM_BASE_URL'] } } });
  await setKey(KEY);
  await mm.reset();
  await settle();
});
test.afterAll(async () => { await resetExpenses(); await setKey(KEY); await db.app_settings.deleteMany({ where: { key: 'ROUTE_PROVIDER' } }); });

test.describe('公共交通機関のルート（API）', () => {
  test('Googleマップで調べているときは、ルートの内訳・所要時間・乗換・運賃が返る。乗換案内サイトへのリンクも付く', async ({ as }) => {
    const c = await as('sato');
    expect(await (await c.get('/api/expenses/transit')).json()).toEqual({ in_app: true });
    const to = '新宿駅';
    const res = await c.post('/api/expenses/transit', { data: { from: '川越駅', to, date: '2026-11-04', time: '08:30' } });
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(d.in_app).toBe(true);
    expect(d.route).toMatchObject({ minutes: 50, transfers: 1, fare_yen: 590 });
    expect(d.route.steps).toEqual([
      { kind: 'walk', minutes: 5 },
      { kind: 'transit', minutes: 25, line: 'JR埼京線', from: '川越', to: '赤羽', stops: 8 },
      { kind: 'transit', minutes: 15, line: 'JR山手線', from: '赤羽', to: '新宿', stops: 6 },
      { kind: 'walk', minutes: 5 },
    ]);
    expect(d.route.summary).toContain('川越駅 → 新宿駅: JR埼京線（川越→赤羽） → JR山手線（赤羽→新宿） 約50分・乗換1回・運賃 ¥590');
    const url = new URL(d.links.yahoo);
    expect(url.origin + url.pathname).toBe('https://transit.yahoo.co.jp/search/result');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ from: '川越駅', to, y: '2026', m: '11', d: '4', hh: '8', m1: '3', m2: '0', type: '1' });
    expect(d.links.google).toContain('travelmode=transit');
    const seen = await mm.mapsCalls();
    expect(seen.last).toMatchObject({ key: KEY, origin: '川越駅', destination: to, mode: 'TRANSIT' });
  });

  test('運賃が分からない経路は、運賃なしで返る。過去の日時は出発時刻として送らない', async ({ as }) => {
    const c = await as('sato');
    const d = await (await c.post('/api/expenses/transit', { data: { from: '東京駅', to: place('大手町'), date: '2020-01-01', time: '09:00' } })).json();
    expect(d.route).toMatchObject({ fare_yen: null, transfers: 0 });
    expect((await mm.mapsCalls()).last!.departureTime).toBeUndefined();
    const future = jstFuture();
    await c.post('/api/expenses/transit', { data: { from: '東京駅', to: place('品川'), date: future, time: '10:15' } });
    expect((await mm.mapsCalls()).last!.departureTime).toBe(new Date(`${future}T10:15:00+09:00`).toISOString());
  });

  test('見つからない場所は422、Googleが落ちているときは502。入力が不正なら400。回数には上限がある', async ({ as }) => {
    const c = await as('suzuki');
    const ask = async (data: object) => { const r = await c.post('/api/expenses/transit', { data }); return [r.status(), (await r.json()).error]; };
    expect(await ask({ from: '川越駅', to: place('見つからない駅'), date: today() })).toEqual([422, 'route_not_found']);
    await mm.failMaps('down');
    expect(await ask({ from: '川越駅', to: place('新宿駅'), date: today() })).toEqual([502, 'route_failed']);
    await mm.failMaps(null);
    for (const bad of [{}, { from: '', to: 'x', date: today() }, { from: 'a', to: 'b', date: '2026-13-01' }, { from: 'a', to: 'b', date: today(), time: '9:00' }, { from: 'あ'.repeat(301), to: 'b', date: today() }]) {
      expect((await c.post('/api/expenses/transit', { data: bad })).status(), JSON.stringify(bad)).toBe(400);
    }
    const codes: number[] = [];
    for (let i = 0; i < 20; i++) codes.push((await c.post('/api/expenses/transit', { data: { from: '川越駅', to: '新宿駅', date: today() } })).status());
    expect(codes.includes(429)).toBe(true);
  });

  test('Google以外の調べ方のときは、ルートは表示せず、リンクだけ返す（無料）', async ({ as }) => {
    await db.app_settings.upsert({ where: { key: 'ROUTE_PROVIDER' }, create: { key: 'ROUTE_PROVIDER', value: 'osm' }, update: { value: 'osm' } });
    await settle();
    const c = await as('yamada');
    expect(await (await c.get('/api/expenses/transit')).json()).toEqual({ in_app: false });
    const d = await (await c.post('/api/expenses/transit', { data: { from: '川越駅', to: '新宿駅', date: today() } })).json();
    expect(d.in_app).toBe(false);
    expect(d.route).toBeUndefined();
    expect(d.links.yahoo).toContain('transit.yahoo.co.jp');
    expect((await mm.mapsCalls()).calls).toBe(0);
  });

  test('未ログインは使えない', async ({ anon }) => {
    expect((await anon.post('/api/expenses/transit', { data: { from: 'a', to: 'b', date: today() }, maxRedirects: 0 })).status()).not.toBe(200);
  });
});

test.describe('交通費の申請に経路を残す（API）', () => {
  const post = (c: import('@playwright/test').APIRequestContext, o: Record<string, string>) => c.post('/api/expenses', { multipart: { expense_date: today(), category: '交通費', title: uniq('出張'), amount: '590', payment_method: 'personal', ...o } });

  test('出発・到着・調べた経路が申請に残り、一覧に乗換案内へのリンクつきで出る。他の科目には付かない', async ({ as }) => {
    const c = await as('tanaka');
    const res = await post(c, { transit_from: '川越駅', transit_to: '新宿駅', transit_summary: '川越駅 → 新宿駅: JR埼京線（川越→新宿） 約45分・乗換0回・運賃 ¥590' });
    expect(res.status()).toBe(201);
    const row = await db.expense_claims.findFirst({ where: { user_id: USERS.tanaka.id } });
    expect(row).toMatchObject({ transit_from: '川越駅', transit_to: '新宿駅', amount: 590 });
    const list = await (await (await as('keiri')).get('/api/expenses?scope=all')).json();
    const t = list.items[0].transit;
    expect(t).toMatchObject({ from: '川越駅', to: '新宿駅' });
    expect(t.summary).toContain('JR埼京線');
    expect(t.yahoo_url).toContain('transit.yahoo.co.jp');
    expect(t.google_url).toContain('travelmode=transit');
    // a claim of another category keeps nothing even if the fields are sent
    expect((await post(c, { category: '会議費', transit_from: 'a', transit_to: 'b' })).status()).toBe(201);
    expect(await db.expense_claims.count({ where: { category: '会議費', transit_from: { not: null } } })).toBe(0);
    // no route: nothing stored
    expect((await post(c, {})).status()).toBe(201);
    expect(await db.expense_claims.count({ where: { transit_from: null, category: '交通費' } })).toBe(1);
  });

  test('編集で経路を直せる・消せる。科目を変えると消える', async ({ as }) => {
    const c = await as('tanaka');
    const { id } = await (await post(c, { transit_from: '川越駅', transit_to: '新宿駅' })).json();
    const patch = (data: object) => c.patch(`/api/expenses/${id}`, { data: { expense_date: today(), category: '交通費', title: 'x', amount: 590, payment_method: 'personal', ...data } });
    expect((await patch({ transit_to: '池袋駅', transit_summary: '川越駅 → 池袋駅: 東武東上線' })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ transit_from: '川越駅', transit_to: '池袋駅', transit_summary: '川越駅 → 池袋駅: 東武東上線' });
    expect((await patch({ description: 'メモ' })).status()).toBe(200);        // not mentioned: kept
    expect((await db.expense_claims.findUnique({ where: { id } }))!.transit_to).toBe('池袋駅');
    expect((await patch({ transit_from: null, transit_to: null, transit_summary: null })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ transit_from: null, transit_to: null, transit_summary: null });
    await patch({ transit_from: 'a', transit_to: 'b' });
    expect((await patch({ category: '会議費' })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ transit_from: null, transit_to: null });
  });
});

test.describe('画面', () => {
  test.use({ storageState: AUTH.sato });

  test('勘定科目「交通費」で、出発・到着を入れて「最適ルートを表示」すると、経路と運賃が出て、運賃を金額に入れて申請でき、詳細に経路が出る', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    const box = page.getByTestId('transit-box');
    await expect(box).toBeVisible();                                   // 交通費 is the first category
    await expect(page.getByRole('link', { name: /Yahoo!乗換案内で見る/ })).toHaveCount(0);   // no places yet
    await page.getByLabel('出発（駅・住所）').fill('川越駅');
    await page.getByLabel('到着（駅・住所）').fill('新宿駅');
    await expect(page.getByRole('link', { name: /Yahoo!乗換案内で見る/ })).toHaveAttribute('href', /transit\.yahoo\.co\.jp\/search\/result\?from=/);
    await expect(page.getByRole('link', { name: /Googleマップで見る/ })).toHaveAttribute('href', /travelmode=transit/);
    await page.getByRole('button', { name: '最適ルートを表示' }).click();
    const result = page.getByTestId('transit-result');
    await expect(result).toContainText('約50分 ・ 乗換1回 ・ 運賃 ¥590');
    await expect(result).toContainText('JR埼京線（川越 → 赤羽）');
    await expect(result).toContainText('JR山手線（赤羽 → 新宿）');
    // changing a place hides the result (it is for the old places)
    await page.getByLabel('到着（駅・住所）').fill('池袋駅');
    await expect(result).toHaveCount(0);
    await page.getByLabel('到着（駅・住所）').fill('新宿駅');
    await page.getByRole('button', { name: '最適ルートを表示' }).click();
    await expect(result).toBeVisible();
    await page.getByRole('button', { name: 'この運賃を金額に入れる' }).click();
    await expect(page.locator('input[type=number]').first()).toHaveValue('590');
    await page.getByPlaceholder(/A社訪問/).fill('川越から新宿への電車');
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('申請しました')).toBeVisible();
    const row = await db.expense_claims.findFirst({ where: { user_id: USERS.sato.id } });
    expect(row).toMatchObject({ amount: 590, transit_from: '川越駅', transit_to: '新宿駅' });
    expect(row!.transit_summary).toContain('JR山手線');
    await page.getByRole('button', { name: /川越から新宿への電車/ }).click();
    await expect(page.getByText('🚆 公共交通機関: 川越駅 → 新宿駅')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Yahoo!乗換案内' })).toHaveAttribute('href', /transit\.yahoo\.co\.jp/);
    await expect(page.getByText(/運賃 ¥590/)).toBeVisible();
  });

  test('運賃が分からないときは、そう表示して、金額には入れない', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await page.getByLabel('出発（駅・住所）').fill('東京駅');
    await page.getByLabel('到着（駅・住所）').fill(place('大手町'));
    await page.getByRole('button', { name: '最適ルートを表示' }).click();
    await expect(page.getByTestId('transit-result')).toContainText('運賃はこの経路では分かりません');
    await expect(page.getByRole('button', { name: 'この運賃を金額に入れる' })).toHaveCount(0);
  });

  test('見つからない場所は、その場でわかる', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await page.getByLabel('出発（駅・住所）').fill('川越駅');
    await page.getByLabel('到着（駅・住所）').fill(place('見つからない駅'));
    await page.getByRole('button', { name: '最適ルートを表示' }).click();
    await expect(page.getByText('ルートが見つかりません。駅名や住所をもう少し詳しく入力してください')).toBeVisible();
  });

  test('Googleマップを使わない設定のときは、「ルートを表示」のボタンはなく、乗換案内のリンクと説明が出る', async ({ page }) => {
    await db.app_settings.upsert({ where: { key: 'ROUTE_PROVIDER' }, create: { key: 'ROUTE_PROVIDER', value: 'osm' }, update: { value: 'osm' } });
    await settle();
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await page.getByLabel('出発（駅・住所）').fill('川越駅');
    await page.getByLabel('到着（駅・住所）').fill('新宿駅');
    await expect(page.getByRole('button', { name: '最適ルートを表示' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Yahoo!乗換案内で見る/ })).toBeVisible();
    await expect(page.getByText('この画面でルートを表示するには、システム管理者がGoogleマップの設定をする必要があります')).toBeVisible();
  });

  test('他の勘定科目では、経路の欄は出ない', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('会議費');
    await expect(page.getByTestId('transit-box')).toHaveCount(0);
  });
});

function jstFuture() { return new Date(Date.now() + 9 * 3600_000 + 5 * 86400_000).toISOString().slice(0, 10); }
