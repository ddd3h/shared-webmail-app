import type { APIRequestContext } from '@playwright/test';
import { test, expect, uniq } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';
import { resetExpenses } from './helpers/seed';
import { field, today } from './helpers/ui';

test.describe.configure({ mode: 'serial' });

const HOME = '東京都千代田区丸の内1-1-1';
const KEY = 'e2e-maps-key';
const setKey = (value: string) => db.app_settings.upsert({ where: { key: 'GOOGLE_MAPS_API_KEY' }, create: { key: 'GOOGLE_MAPS_API_KEY', value, is_secret: true }, update: { value, is_secret: true } });
const setHome = (id: string, home_address: string | null) => db.users.update({ where: { id }, data: { home_address } });

test.beforeEach(async () => {
  await resetExpenses();
  await db.users.updateMany({ data: { home_address: null } });
  await db.app_settings.deleteMany({ where: { key: 'MILEAGE_RATE_PER_KM' } });
  await setKey(KEY);
  await mm.reset();
  await new Promise(r => setTimeout(r, 300)); // the server remembers settings for a moment
});
test.afterAll(async () => {
  await db.users.updateMany({ data: { home_address: null } });
  await db.app_settings.deleteMany({ where: { key: 'MILEAGE_RATE_PER_KM' } });
  await setKey(KEY);
  await resetExpenses();
});

// A destination Google (the stand-in) has not been asked about before in this run: results are remembered for an hour.
const place = (name: string) => `${name}${uniq('')}`;

const claim = (c: APIRequestContext, o: Record<string, string> = {}) => c.post('/api/expenses', {
  multipart: { expense_date: today(), category: '自家用車', title: uniq('訪問'), payment_method: 'personal', ...o },
});

test.describe('自宅（プロフィール）', () => {
  test('登録・変更・削除でき、監査ログには住所そのものを残さない', async ({ as }) => {
    const c = await as('sato');
    expect((await (await c.get('/api/profile/home')).json()).home_address).toBeNull();
    const put = await c.put('/api/profile/home', { data: { home_address: `  ${HOME}  ` } });
    expect(put.status()).toBe(200);
    expect((await (await c.get('/api/profile/home')).json()).home_address).toBe(HOME);
    expect((await c.put('/api/profile/home', { data: { home_address: 'x'.repeat(301) } })).status()).toBe(400);
    const log = await db.audit_logs.findFirst({ where: { action_type: 'home_address_update', target_id: USERS.sato.id }, orderBy: { created_at: 'desc' } });
    expect(log!.metadata_json).not.toContain('丸の内');
    expect((await c.put('/api/profile/home', { data: { home_address: '' } })).status()).toBe(200);
    expect((await (await c.get('/api/profile/home')).json()).home_address).toBeNull();
  });

  test('ログインしていなければ使えない', async ({ anon }) => {
    expect((await anon.get('/api/profile/home', { maxRedirects: 0 })).status()).not.toBe(200);
  });

  test('画面: プロフィールの「自宅」に入れて保存できる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/profile');
    await page.getByRole('button', { name: /^自宅/ }).first().click();
    await page.getByLabel('自宅の住所').fill(HOME);
    await page.locator('#home-address').locator('xpath=../..').getByRole('button', { name: '自宅を保存' }).click();
    await expect(page.getByText('自宅を保存しました')).toBeVisible();
    expect((await db.users.findUnique({ where: { id: USERS.sato.id } }))!.home_address).toBe(HOME);
    await ctx.close();
  });
});

test.describe('自家用車の計算（API）', () => {
  test('自宅が未登録なら、計算も申請もできない', async ({ as }) => {
    const c = await as('tanaka');
    const est = await c.post('/api/expenses/mileage/estimate', { data: { destination: '新宿駅' } });
    expect(est.status()).toBe(400);
    expect((await est.json()).error).toBe('home_not_set');
    const res = await claim(c, { destination: '新宿駅' });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('home_not_set');
    expect(await db.expense_claims.count()).toBe(0);
  });

  test('往復を1km20円で計算する（片道12.34km → 往復24.7km → 494円）。Googleには自宅と行き先を車で聞く', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const c = await as('tanaka');
    const dest = place('新宿駅');
    const res = await c.post('/api/expenses/mileage/estimate', { data: { destination: dest } });
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ origin: HOME, destination: dest, one_way_km: 12.3, round_trip_km: 24.7, rate_per_km: 20, amount: 494, source: 'google' });
    expect(d.map_url).toContain('google.com/maps/dir');
    expect(d.map_url).toContain(encodeURIComponent(HOME));
    const seen = await mm.mapsCalls();
    expect(seen.calls).toBe(1);
    expect(seen.last).toMatchObject({ key: KEY, origin: HOME, destination: dest, mode: 'DRIVE' });
    // the same pair again is remembered: no second search is billed
    await c.post('/api/expenses/mileage/estimate', { data: { destination: dest } });
    expect((await mm.mapsCalls()).calls).toBe(1);
  });

  test('申請の金額は画面の数字ではなくサーバーが計算する。自家用車は必ず立替', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const c = await as('tanaka');
    const dest = place('横浜駅');
    const res = await claim(c, { destination: dest, amount: '1', payment_method: 'company' });
    expect(res.status()).toBe(201);
    const row = await db.expense_claims.findFirst({ where: { user_id: USERS.tanaka.id } });
    expect(row).toMatchObject({ category: '自家用車', amount: 1400, payment_method: 'personal', status: 'pending', mileage_origin: HOME, mileage_destination: dest, mileage_distance_m: 70000, mileage_rate: 20, mileage_source: 'google' });
  });

  test('行き先がなければ400。自家用車以外は、今までどおり金額が必要', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const c = await as('tanaka');
    expect((await claim(c)).status()).toBe(400);
    expect((await claim(c, { category: '交通費' })).status()).toBe(400);
    expect((await claim(c, { category: '交通費', amount: '1200' })).status()).toBe(201);
    const row = await db.expense_claims.findFirst({ where: { category: '交通費' } });
    expect(row!.mileage_distance_m).toBeNull();
  });

  test('見つからない行き先は422、Googleが落ちている・キーが違うときは502', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const c = await as('tanaka');
    const nf = await c.post('/api/expenses/mileage/estimate', { data: { destination: place('見つからない場所') } });
    expect([nf.status(), (await nf.json()).error]).toEqual([422, 'route_not_found']);
    for (const mode of ['down', 'denied'] as const) {
      await mm.failMaps(mode);
      const r = await c.post('/api/expenses/mileage/estimate', { data: { destination: place('新宿') } });
      expect([mode, r.status(), (await r.json()).error]).toEqual([mode, 502, 'route_failed']);
      expect((await claim(c, { destination: place('新宿') })).status()).toBe(502);
    }
    expect(await db.expense_claims.count()).toBe(0);
  });

  test('入力が不正なら400（行き先なし・長すぎる）', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const c = await as('tanaka');
    for (const data of [{}, { destination: '' }, { destination: 'あ'.repeat(301) }]) expect((await c.post('/api/expenses/mileage/estimate', { data })).status()).toBe(400);
  });

  test('計算の回数には上限がある（1分に20回まで）', async ({ as }) => {
    await setHome(USERS.suzuki.id, HOME);
    const c = await as('suzuki');
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await c.post('/api/expenses/mileage/estimate', { data: { destination: '新宿駅' } })).status());
    expect(codes.slice(0, 20).every(s => s === 200)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
  });
});

test.describe('単価とAPIキー（システム管理者）', () => {
  test('管理者だけが単価を変えられ、これからの申請に反映される。申請済みの金額は変わらない', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const admin = await as('admin');
    const c = await as('tanaka');
    const dest = place('新宿駅');
    const first = await claim(c, { destination: dest });
    expect(first.status()).toBe(201);
    const { id } = await first.json();

    expect((await (await admin.get('/api/admin/expense-settings')).json())).toMatchObject({ rate_per_km: 20, maps_api_key_set: true });
    expect((await (await as('sato')).put('/api/admin/expense-settings', { data: { rate_per_km: 99 } })).status()).toBe(403);
    expect((await (await as('keiri')).put('/api/admin/expense-settings', { data: { rate_per_km: 99 } })).status()).toBe(403);
    for (const bad of [0, 1001, 2.5, '20']) expect((await admin.put('/api/admin/expense-settings', { data: { rate_per_km: bad } })).status(), String(bad)).toBe(400);
    expect((await admin.put('/api/admin/expense-settings', { data: { rate_per_km: 30 } })).status()).toBe(200);
    await new Promise(r => setTimeout(r, 300));

    expect((await (await c.get('/api/expenses/mileage')).json())).toMatchObject({ rate_per_km: 30, route_service: true, home_address: HOME });
    expect((await (await c.post('/api/expenses/mileage/estimate', { data: { destination: dest } })).json()).amount).toBe(741); // 24.7km x 30
    expect((await db.expense_claims.findUnique({ where: { id } }))).toMatchObject({ amount: 494, mileage_rate: 20 });

    // editing without changing the trip keeps the figures it was sent with; changing the place works it out again at today's rate
    const patch = (data: object) => c.patch(`/api/expenses/${id}`, { data: { expense_date: today(), category: '自家用車', title: 'x', payment_method: 'personal', ...data } });
    expect((await patch({ destination: dest, description: 'メモ' })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ amount: 494, mileage_rate: 20, description: 'メモ' });
    expect((await patch({ destination: place('横浜駅') })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ amount: 2100, mileage_rate: 30, status: 'pending' });
    // turning it into an ordinary claim clears the route and needs an amount
    expect((await patch({ category: '交通費' })).status()).toBe(400);
    expect((await patch({ category: '交通費', amount: 800 })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ amount: 800, mileage_distance_m: null, mileage_origin: null });
    const audit = await db.audit_logs.findFirst({ where: { action_type: 'expense_settings_update' }, orderBy: { created_at: 'desc' } });
    expect(JSON.parse(audit!.metadata_json)).toMatchObject({ rate_from: 20, rate_to: 30 });
  });

  test('APIキーを外すと、行き先と片道の距離を自分で入力する方式になる。キーがあるときは手入力を受け付けない', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const admin = await as('admin');
    const c = await as('tanaka');
    expect((await claim(c, { destination: '新宿駅', manual_one_way_km: '10' })).status()).toBe(400);
    expect(((await (await admin.get('/api/admin/expense-settings')).json()).maps_api_key_set)).toBe(true);

    expect((await admin.put('/api/admin/expense-settings', { data: { maps_api_key: '' } })).status()).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    expect((await (await admin.get('/api/admin/expense-settings')).json()).maps_api_key_set).toBe(false);
    expect((await (await c.get('/api/expenses/mileage')).json()).route_service).toBe(false);

    const need = await c.post('/api/expenses/mileage/estimate', { data: { destination: '新宿駅' } });
    expect([need.status(), (await need.json()).error]).toEqual([400, 'distance_required']);
    const est = await (await c.post('/api/expenses/mileage/estimate', { data: { destination: '新宿駅', manual_one_way_km: 10 } })).json();
    expect(est).toMatchObject({ round_trip_km: 20, amount: 400, source: 'manual' });
    const res = await claim(c, { destination: '新宿駅', manual_one_way_km: '10' });
    expect(res.status()).toBe(201);
    expect(await db.expense_claims.findFirst({ where: { user_id: USERS.tanaka.id } })).toMatchObject({ amount: 400, mileage_source: 'manual', mileage_distance_m: 20000 });
    expect((await mm.mapsCalls()).calls).toBe(0);
    // an absurd distance is refused
    expect((await claim(c, { destination: '新宿駅', manual_one_way_km: '5000' })).status()).toBe(400);

    // a key can be put back, and is never sent back
    expect((await admin.put('/api/admin/expense-settings', { data: { maps_api_key: 'AIza-new' } })).status()).toBe(200);
    expect(JSON.stringify(await (await admin.get('/api/admin/expense-settings')).json())).not.toContain('AIza-new');
  });
});

test.describe('経理・管理者の確認', () => {
  test('一覧にルートの内訳と地図のリンクが付く（本人と経理・管理者だけ）', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const dest = place('新宿駅');
    expect((await claim(await as('tanaka'), { destination: dest })).status()).toBe(201);
    const all = await (await (await as('keiri')).get('/api/expenses?scope=all')).json();
    const item = all.items.find((i: { mileage: unknown }) => i.mileage);
    expect(item.mileage).toMatchObject({ origin: HOME, destination: dest, round_trip_km: 24.7, rate_per_km: 20, source: 'google' });
    expect(item.mileage.map_url).toContain('google.com/maps/dir');
    expect((await (await as('sato')).get('/api/expenses?scope=all')).status()).toBe(403);
    expect((await (await as('sato')).get('/api/expenses')).status()).toBe(200);
    expect((await (await (await as('sato')).get('/api/expenses')).json()).items).toHaveLength(0);
  });
});

test.describe('経費の申請（画面）', () => {
  test.use({ storageState: AUTH.sato });

  test('自宅が未登録なら、プロフィールへの案内が出て、申請できない', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('自家用車');
    await expect(page.getByText('自宅が登録されていません')).toBeVisible();
    await expect(page.getByRole('link', { name: 'プロフィールで自宅を登録' })).toHaveAttribute('href', '/profile#home');
    await expect(page.getByRole('button', { name: '申請する' })).toBeDisabled();
  });

  test('行き先を入れて計算すると往復の距離と金額が出て、申請すると一覧に出る', async ({ page }) => {
    await setHome(USERS.sato.id, HOME);
    const dest = place('新宿駅');
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('自家用車');
    await expect(page.getByText('1kmあたり20円で計算します')).toBeVisible();
    await expect(page.getByRole('button', { name: '申請する' })).toBeDisabled();
    await page.getByLabel('行き先（住所・施設名）').fill(dest);
    await page.getByRole('button', { name: 'ルートを調べて金額を計算' }).click();
    const result = page.getByTestId('mileage-result');
    await expect(result).toContainText('往復 24.7 km × 20円');
    await expect(result).toContainText('¥494');
    // changing the place hides the figure until it is worked out again
    await page.getByLabel('行き先（住所・施設名）').fill(dest + 'x');
    await expect(result).toHaveCount(0);
    await page.getByLabel('行き先（住所・施設名）').fill(dest);
    await page.getByRole('button', { name: 'ルートを調べて金額を計算' }).click();
    await expect(result).toContainText('¥494');
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('申請しました')).toBeVisible();
    const card = page.getByRole('button', { name: /自家用車: 自宅→/ });
    await expect(card).toContainText('¥494');
    await expect(card).toContainText('立替');
    await card.click();
    await expect(page.getByText(`自宅 → ${dest}（往復 24.7 km × 20円）`)).toBeVisible();
    await expect(page.getByRole('link', { name: '地図でルートを見る' })).toHaveAttribute('href', /google\.com\/maps\/dir/);
  });

  test('見つからない行き先はその場でわかる', async ({ page }) => {
    await setHome(USERS.sato.id, HOME);
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('自家用車');
    await page.getByLabel('行き先（住所・施設名）').fill(place('見つからない場所'));
    await page.getByRole('button', { name: 'ルートを調べて金額を計算' }).click();
    await expect(page.getByText('行き先が見つかりません。住所や施設名')).toBeVisible();
    await expect(page.getByRole('button', { name: '申請する' })).toBeDisabled();
  });

  test('APIキーがないときは、片道の距離を入力する欄が出る', async ({ page }) => {
    await setHome(USERS.sato.id, HOME);
    await setKey('');
    await new Promise(r => setTimeout(r, 300));
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('自家用車');
    await expect(page.getByText('ルートの自動検索（Googleマップ）が設定されていないため')).toBeVisible();
    await page.getByLabel('行き先（住所・施設名）').fill('取引先');
    await page.getByLabel('片道の距離（km）').fill('7.5');
    await page.getByRole('button', { name: '金額を計算' }).click();
    await expect(page.getByTestId('mileage-result')).toContainText('往復 15 km × 20円');
    await expect(page.getByTestId('mileage-result')).toContainText('¥300');
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('申請しました')).toBeVisible();
    await expect(page.getByRole('button', { name: /自家用車: 自宅→取引先/ })).toContainText('¥300');
  });
});

test.describe('管理画面の設定（画面）', () => {
  test('システム設定に単価の欄があり、保存できる', async ({ browser, as }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: /経費（自家用車）/ }).first().click();
    const rate = page.getByLabel('1kmあたりの単価（円）');
    await expect(rate).toHaveValue('20');
    await rate.fill('25');
    await page.getByRole('button', { name: '保存', exact: true }).first().click();
    await expect(page.getByText('単価を保存しました')).toBeVisible();
    expect((await (await (await as('admin')).get('/api/admin/expense-settings')).json()).rate_per_km).toBe(25);
    await expect(page.getByPlaceholder('設定済み（変更するときだけ入力）')).toBeVisible();
    await ctx.close();
  });
});
