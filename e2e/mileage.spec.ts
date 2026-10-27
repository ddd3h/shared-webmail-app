import type { APIRequestContext } from '@playwright/test';
import { test, expect, uniq } from './fixtures';
import { AUTH, MM_URL, USERS } from './helpers/constants';
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
  await db.app_settings.deleteMany({ where: { key: { in: ['MILEAGE_RATE_PER_KM', 'ROUTE_PROVIDER', 'OSRM_BASE_URL'] } } });
  await setKey(KEY);
  await mm.reset();
  await new Promise(r => setTimeout(r, 300)); // the server remembers settings for a moment
});
test.afterAll(async () => {
  await db.users.updateMany({ data: { home_address: null } });
  await db.app_settings.deleteMany({ where: { key: { in: ['MILEAGE_RATE_PER_KM', 'ROUTE_PROVIDER', 'OSRM_BASE_URL'] } } });
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

  test('出発地は自宅が初期値で、申請ごとに変えられる。自宅が未登録でも、出発地があれば計算・申請できる', async ({ as }) => {
    const c = await as('tanaka');                        // no home on file
    const dest = place('横浜駅');
    const from = '東京都新宿区西新宿2-8-1';
    const est = await c.post('/api/expenses/mileage/estimate', { data: { destination: dest, origin: from } });
    expect(est.status()).toBe(200);
    expect(await est.json()).toMatchObject({ origin: from, destination: dest, round_trip_km: 70, amount: 1400 });
    expect((await mm.mapsCalls()).last).toMatchObject({ origin: from, destination: dest });
    expect((await c.post('/api/expenses/mileage/estimate', { data: { destination: dest, origin: 'あ'.repeat(301) } })).status()).toBe(400);
    expect((await c.post('/api/expenses/mileage/estimate', { data: { destination: dest, origin: '  ' } })).status()).toBe(400); // blank = home, and there is none

    await setHome(USERS.tanaka.id, HOME);
    const homeEst = await (await c.post('/api/expenses/mileage/estimate', { data: { destination: dest } })).json();
    expect(homeEst.origin).toBe(HOME);                    // nothing given: home
    const res = await claim(c, { destination: dest, origin: from });
    expect(res.status()).toBe(201);
    const row = await db.expense_claims.findFirst({ where: { user_id: USERS.tanaka.id } });
    expect(row).toMatchObject({ mileage_origin: from, mileage_destination: dest, amount: 1400 });
    // the list says whether it started at home
    const list = await (await (await as('keiri')).get('/api/expenses?scope=all')).json();
    expect(list.items[0].mileage).toMatchObject({ origin: from, from_home: false });
    expect((await claim(c, { destination: dest })).status()).toBe(201);
    const list2 = await (await (await as('keiri')).get('/api/expenses?scope=all')).json();
    expect(list2.items.filter((i: { mileage: { from_home: boolean } }) => i.mileage.from_home)).toHaveLength(1);   // the one that started at home

    // editing: the same start and place keep the figures; another start works it out again
    const { id } = await (await claim(c, { destination: dest, origin: from })).json();
    const patch = (data: object) => c.patch(`/api/expenses/${id}`, { data: { expense_date: today(), category: '自家用車', title: 'x', payment_method: 'personal', destination: dest, ...data } });
    await db.app_settings.upsert({ where: { key: 'MILEAGE_RATE_PER_KM' }, create: { key: 'MILEAGE_RATE_PER_KM', value: '30' }, update: { value: '30' } });
    await new Promise(r => setTimeout(r, 300));
    expect((await patch({ origin: from, description: 'メモ' })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ amount: 1400, mileage_rate: 20, mileage_origin: from });   // untouched: the old rate stays
    expect((await patch({ origin: '東京都千代田区丸の内1-9-1' })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ amount: 2100, mileage_rate: 30, mileage_origin: '東京都千代田区丸の内1-9-1' });
    expect((await patch({})).status()).toBe(200);          // no start given = home: it changes back to the home and is worked out again
    expect((await db.expense_claims.findUnique({ where: { id } }))!.mileage_origin).toBe(HOME);
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

  test('「調べない」を選ぶと、行き先と片道の距離を自分で入力する方式になる。調べるときは手入力を受け付けない', async ({ as }) => {
    await setHome(USERS.tanaka.id, HOME);
    const admin = await as('admin');
    const c = await as('tanaka');
    expect((await claim(c, { destination: '新宿駅', manual_one_way_km: '10' })).status()).toBe(400);
    expect(await (await admin.get('/api/admin/expense-settings')).json()).toMatchObject({ maps_api_key_set: true, route_provider: 'google' });

    expect((await admin.put('/api/admin/expense-settings', { data: { route_provider: 'manual' } })).status()).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    expect((await (await admin.get('/api/admin/expense-settings')).json()).route_provider).toBe('manual');
    expect((await (await c.get('/api/expenses/mileage')).json()).route_service).toBe(false);

    const need = await c.post('/api/expenses/mileage/estimate', { data: { destination: '新宿駅' } });
    expect([need.status(), (await need.json()).error]).toEqual([400, 'distance_required']);
    const est = await (await c.post('/api/expenses/mileage/estimate', { data: { destination: '新宿駅', manual_one_way_km: 10 } })).json();
    expect(est).toMatchObject({ round_trip_km: 20, amount: 400, source: 'manual' });
    const res = await claim(c, { destination: '新宿駅', manual_one_way_km: '10' });
    expect(res.status()).toBe(201);
    expect(await db.expense_claims.findFirst({ where: { user_id: USERS.tanaka.id } })).toMatchObject({ amount: 400, mileage_source: 'manual', mileage_distance_m: 20000 });
    expect((await mm.mapsCalls()).calls).toBe(0);
    expect((await mm.osm.state()).osrm).toHaveLength(0);
    // an absurd distance is refused
    expect((await claim(c, { destination: '新宿駅', manual_one_way_km: '5000' })).status()).toBe(400);

    // a key can be put back, and is never sent back
    expect((await admin.put('/api/admin/expense-settings', { data: { maps_api_key: 'AIza-new' } })).status()).toBe(200);
    expect(JSON.stringify(await (await admin.get('/api/admin/expense-settings')).json())).not.toContain('AIza-new');
  });
});

test.describe('無料の調べ方（OpenStreetMap）', () => {
  const useOsm = async (as: (r: 'admin') => Promise<import('@playwright/test').APIRequestContext>) => {
    expect((await (await as('admin')).put('/api/admin/expense-settings', { data: { route_provider: 'osm' } })).status()).toBe(200);
    await new Promise(r => setTimeout(r, 300));
  };

  test('国土地理院で住所を探し、OSRMで道のりを出す。Googleは使わない。キーがなくても使える', async ({ as }) => {
    await useOsm(as);
    await setHome(USERS.tanaka.id, HOME);
    const c = await as('tanaka');
    const dest = place('新宿駅');
    const res = await c.post('/api/expenses/mileage/estimate', { data: { destination: dest } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ one_way_km: 12.3, round_trip_km: 24.7, rate_per_km: 20, amount: 494, source: 'osm' });
    const seen = await mm.osm.state();
    expect(seen.gsi).toEqual([HOME, dest]);                 // both places were looked up as addresses
    expect(seen.nominatim).toHaveLength(0);                 // the address search knew them: nothing else is asked
    expect(seen.osrm).toHaveLength(1);
    expect(seen.osrm[0]).toContain('/route/v1/driving/139.764,35.6812;139.6917,35.6895');
    expect((await mm.mapsCalls()).calls).toBe(0);
    // a second ask is remembered
    await c.post('/api/expenses/mileage/estimate', { data: { destination: dest } });
    expect((await mm.osm.state()).osrm).toHaveLength(1);

    // the key can be taken away: nothing changes for the free way
    await (await as('admin')).put('/api/admin/expense-settings', { data: { maps_api_key: '' } });
    await new Promise(r => setTimeout(r, 300));
    expect((await (await c.get('/api/expenses/mileage')).json())).toMatchObject({ route_service: true });
    const claimed = await claim(c, { destination: dest });
    expect(claimed.status()).toBe(201);
    expect(await db.expense_claims.findFirst({ where: { user_id: USERS.tanaka.id } })).toMatchObject({ amount: 494, mileage_source: 'osm', mileage_distance_m: 24700 });
  });

  test('住所でなく施設名のときは、OpenStreetMap（Nominatim）で探す。名前で身元を明かして、1秒に1回まで', async ({ as }) => {
    await useOsm(as);
    await setHome(USERS.tanaka.id, HOME);
    const c = await as('tanaka');
    const res = await c.post('/api/expenses/mileage/estimate', { data: { destination: '東京タワー' } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ one_way_km: 8, round_trip_km: 16, amount: 320, source: 'osm' });
    const seen = await mm.osm.state();
    expect(seen.nominatim.map(n => n.q)).toEqual(['東京タワー']);
    expect(seen.nominatim[0].ua).toContain('shared-webmail-app');
    // the home address is known to the 国土地理院 search, so only the tower went to Nominatim
  });

  test('見つからない場所は422。サービスが落ちているときは502。道がつながらないときは422', async ({ as }) => {
    await useOsm(as);
    await setHome(USERS.yamada.id, HOME);
    const c = await as('yamada');
    const ask = async (destination: string) => { const r = await c.post('/api/expenses/mileage/estimate', { data: { destination } }); return [r.status(), (await r.json()).error]; };
    expect(await ask(place('どこにもない場所'))).toEqual([422, 'route_not_found']);
    await mm.osm.fail('osrm');
    expect(await ask(place('新宿駅'))).toEqual([502, 'route_failed']);
    await mm.osm.fail('noroute');
    expect(await ask(place('新宿駅'))).toEqual([422, 'route_not_found']);
    await mm.osm.fail('gsi');
    expect(await ask(place('横浜駅'))).toEqual([502, 'route_failed']);   // the address search is down and Nominatim does not know it either
    await mm.osm.fail('nominatim');
    expect(await ask(place('どこかの店'))).toEqual([502, 'route_failed']);
    await mm.osm.fail(null);
    expect(await ask(place('新宿駅'))).toEqual([200, undefined]);
    expect(await db.expense_claims.count()).toBe(0);
  });

  test('管理者の設定: Googleはキーがあるときだけ選べる。自前のOSRMサーバーのアドレスを入れると、そちらに聞く', async ({ as }) => {
    const admin = await as('admin');
    await admin.put('/api/admin/expense-settings', { data: { maps_api_key: '' } });
    expect((await admin.put('/api/admin/expense-settings', { data: { route_provider: 'google' } })).status()).toBe(400);
    expect((await admin.put('/api/admin/expense-settings', { data: { route_provider: 'bing' } })).status()).toBe(400);
    for (const bad of ['ftp://x', 'router', 'http://']) expect((await admin.put('/api/admin/expense-settings', { data: { osrm_url: bad } })).status(), bad).toBe(400);
    expect((await (await admin.get('/api/admin/expense-settings')).json())).toMatchObject({ route_provider: 'osm', maps_api_key_set: false, osrm_url: null });
    expect((await (await as('sato')).put('/api/admin/expense-settings', { data: { route_provider: 'osm' } })).status()).toBe(403);

    // a route server of one's own: the address is used instead of the public one (here the stand-in under another path)
    await setHome(USERS.tanaka.id, HOME);
    expect((await admin.put('/api/admin/expense-settings', { data: { osrm_url: `${MM_URL}/osrm/` } })).status()).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    expect((await (await admin.get('/api/admin/expense-settings')).json()).osrm_url).toBe(`${MM_URL}/osrm/`);
    expect((await (await (await as('tanaka')).post('/api/expenses/mileage/estimate', { data: { destination: place('新宿駅') } })).json()).source).toBe('osm');
    expect((await admin.put('/api/admin/expense-settings', { data: { osrm_url: '' } })).status()).toBe(200);
    expect((await (await admin.get('/api/admin/expense-settings')).json()).osrm_url).toBeNull();
    // with a key, Google can be chosen again
    await admin.put('/api/admin/expense-settings', { data: { maps_api_key: 'AIza-x' } });
    expect((await admin.put('/api/admin/expense-settings', { data: { route_provider: 'google' } })).status()).toBe(200);
    expect((await (await admin.get('/api/admin/expense-settings')).json()).route_provider).toBe('google');
  });

  test('画面: 管理画面で「距離の調べ方」を切り替えられる。申請の詳細に何で計算したかが出る', async ({ browser, as }) => {
    await setHome(USERS.sato.id, HOME);
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: /経費（自家用車）/ }).first().click();
    await expect(page.getByLabel(/Googleマップ（有料/)).toBeChecked();
    await page.getByLabel(/OpenStreetMap（無料/).click();
    await expect(page.getByText('距離の調べ方を「OpenStreetMap」にしました')).toBeVisible();
    await expect(page.getByLabel('ルート検索サーバーのアドレス（任意）')).toBeVisible();
    await page.getByLabel(/調べない/).click();
    await expect(page.getByText('距離の調べ方を「調べない」にしました')).toBeVisible();
    await page.getByLabel(/OpenStreetMap（無料/).click();
    await expect(page.getByText('距離の調べ方を「OpenStreetMap」にしました')).toBeVisible();
    expect((await db.app_settings.findUnique({ where: { key: 'ROUTE_PROVIDER' } }))!.value).toBe('osm');
    await ctx.close();

    // and what it was worked out with shows on the claim
    await new Promise(r => setTimeout(r, 300));
    const sato = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP' });
    const p2 = await sato.newPage();
    expect((await claim(await as('sato'), { destination: place('新宿駅') })).status()).toBe(201);
    await p2.goto('/expenses');
    await p2.getByRole('button', { name: /自家用車: |訪問/ }).first().click();
    await expect(p2.getByText('OpenStreetMapの道路データで計算')).toBeVisible();
    await sato.close();
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

  test('自宅が未登録なら、プロフィールへの案内が出る。出発地を自分で入れれば申請できる', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('自家用車');
    await expect(page.getByText('自宅が未登録です')).toBeVisible();
    await expect(page.getByRole('link', { name: 'プロフィールで自宅を登録' })).toHaveAttribute('href', '/profile#home');
    await expect(page.getByLabel('出発地（住所・施設名）')).toHaveValue('');
    await page.getByLabel('行き先（住所・施設名）').fill(place('新宿駅'));
    await expect(page.getByRole('button', { name: 'ルートを調べて金額を計算' })).toBeDisabled();   // no start yet
    await expect(page.getByRole('button', { name: '申請する' })).toBeDisabled();
    await page.getByLabel('出発地（住所・施設名）').fill('東京都千代田区丸の内1-9-1');
    await page.getByRole('button', { name: 'ルートを調べて金額を計算' }).click();
    await expect(page.getByTestId('mileage-result')).toContainText('¥494');
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('申請しました')).toBeVisible();
    expect(await db.expense_claims.findFirst({ where: { user_id: USERS.sato.id } })).toMatchObject({ mileage_origin: '東京都千代田区丸の内1-9-1', amount: 494 });
  });

  test('出発地は自宅が初期値。書き換えて計算・申請でき、「自宅に戻す」で戻せる。詳細には出発地が出る', async ({ page }) => {
    await setHome(USERS.sato.id, HOME);
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('自家用車');
    const origin = page.getByLabel('出発地（住所・施設名）');
    await expect(origin).toHaveValue(HOME);
    await expect(page.getByText('自宅から出発')).toBeVisible();
    const dest = place('横浜駅');
    await page.getByLabel('行き先（住所・施設名）').fill(dest);
    await page.getByRole('button', { name: 'ルートを調べて金額を計算' }).click();
    await expect(page.getByTestId('mileage-result')).toContainText('¥1,400');
    // changing the start hides the figure; the new start is what is asked
    await origin.fill('東京都新宿区西新宿2-8-1');
    await expect(page.getByTestId('mileage-result')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '自宅に戻す' })).toBeVisible();
    await page.getByRole('button', { name: 'ルートを調べて金額を計算' }).click();
    await expect(page.getByTestId('mileage-result')).toBeVisible();
    expect((await mm.mapsCalls()).last).toMatchObject({ origin: '東京都新宿区西新宿2-8-1', destination: dest });
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('申請しました')).toBeVisible();
    const card = page.getByRole('button', { name: /自家用車: 自宅→/ });   // the title was made when the first figure came out, from home
    await card.click();
    await expect(page.getByText(`🚗 自家用車: 東京都新宿区西新宿2-8-1 → ${dest}`)).toBeVisible();
    expect(await db.expense_claims.findFirst({ where: { user_id: USERS.sato.id } })).toMatchObject({ mileage_origin: '東京都新宿区西新宿2-8-1', mileage_destination: dest });
    // editing it opens with that start, and "自宅に戻す" puts the home back
    await page.getByRole('button', { name: '編集' }).click();
    await expect(page.getByLabel('出発地（住所・施設名）')).toHaveValue('東京都新宿区西新宿2-8-1');
    await page.getByRole('button', { name: '自宅に戻す' }).click();
    await expect(page.getByLabel('出発地（住所・施設名）')).toHaveValue(HOME);
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

  test('「調べない」のときは、片道の距離を入力する欄が出る', async ({ page }) => {
    await setHome(USERS.sato.id, HOME);
    await db.app_settings.upsert({ where: { key: 'ROUTE_PROVIDER' }, create: { key: 'ROUTE_PROVIDER', value: 'manual' }, update: { value: 'manual' } });
    await new Promise(r => setTimeout(r, 300));
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await field(page, '勘定科目').selectOption('自家用車');
    await expect(page.getByText('ルートの自動検索を使わない設定のため')).toBeVisible();
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
