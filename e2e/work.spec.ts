import { test, expect, uniq } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { resetPayslips, resetWork, setWorkerType } from './helpers/seed';
import { addDays, field, today } from './helpers/ui';

test.beforeEach(async () => { await resetWork(); await resetPayslips(); });
test.afterEach(async () => {
  await setWorkerType(USERS.tanaka.id, 'employee');
  await setWorkerType(USERS.sato.id, 'employee');
});

const tab = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name, exact: true });
const punchBtn = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name, exact: true });
const month = () => today().slice(0, 7);

test.describe('区分ごとに使える機能（タブ）', () => {
  for (const [role, label, visible, hidden] of [
    ['sato', '従業員', ['勤怠', '給与明細'], ['業務報告', '報酬明細', '管理']],
    ['suzuki', '業務委託', ['業務報告', '報酬明細'], ['勤怠', '給与明細', '管理']],
    ['yamada', '役員', ['報酬明細'], ['勤怠', '業務報告', '給与明細', '管理']],
    ['admin', '従業員', ['勤怠', '給与明細', '管理'], ['業務報告']],
  ] as const) {
    test(`${USERS[role].name}（${label}）のタブ: ${visible.join('・')}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: AUTH[role], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
      const page = await ctx.newPage();
      await page.goto('/work');
      await expect(page.getByText(`${USERS[role].name} さん（${label}）`)).toBeVisible();
      for (const t of visible) await expect(tab(page, t)).toBeVisible();
      for (const t of hidden) await expect(tab(page, t)).toHaveCount(0);
      await ctx.close();
    });
  }

  test('管理者が区分を変えると、画面のタブが変わる', async ({ browser, as }) => {
    const res = await (await as('admin')).patch(`/api/work/users/${USERS.tanaka.id}`, { data: { worker_type: 'contractor' } });
    expect(res.status()).toBe(200);
    const ctx = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await expect(tab(page, '業務報告')).toBeVisible();
    await expect(tab(page, '勤怠')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('区分の設定（管理者）', () => {
  test('一般ユーザーは区分を変更できない', async ({ as }) => {
    const res = await (await as('sato')).patch(`/api/work/users/${USERS.tanaka.id}`, { data: { worker_type: 'executive' } });
    expect(res.status()).toBe(403);
    expect((await db.users.findUnique({ where: { id: USERS.tanaka.id } }))!.worker_type).toBe('employee');
  });

  for (const bad of ['manager', '', 'EMPLOYEE']) {
    test(`不正な区分「${bad}」は400`, async ({ as }) => {
      expect((await (await as('admin')).patch(`/api/work/users/${USERS.tanaka.id}`, { data: { worker_type: bad } })).status()).toBe(400);
    });
  }

  test('存在しないユーザーは404、区分の変更は監査ログに残る', async ({ as }) => {
    const c = await as('admin');
    expect((await c.patch('/api/work/users/nobody', { data: { worker_type: 'employee' } })).status()).toBe(404);
    await c.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { worker_type: 'executive' } });
    const log = await db.audit_logs.findFirst({ where: { action_type: 'worker_type_update', target_id: USERS.tanaka.id }, orderBy: { created_at: 'desc' } });
    expect(JSON.parse(log!.metadata_json)).toEqual({ from: 'employee', to: 'executive' });
  });

  test('画面の「区分・設定」で区分を選ぶと保存される', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await tab(page, '管理').click();
    await page.getByLabel('田中の区分').selectOption('contractor');
    await expect(page.getByText('区分を更新しました')).toBeVisible();
    expect((await db.users.findUnique({ where: { id: USERS.tanaka.id } }))!.worker_type).toBe('contractor');
    await ctx.close();
  });

  test('ユーザー一覧は管理者だけが取得できる', async ({ as }) => {
    expect((await (await as('sato')).get('/api/work/users')).status()).toBe(403);
    const items = (await (await (await as('admin')).get('/api/work/users')).json()).items;
    expect(items).toHaveLength(6);
    expect(items[0]).not.toHaveProperty('password_hash');
  });
});

test.describe('打刻（従業員の画面）', () => {
  test.use({ storageState: AUTH.sato });

  test('出勤→休憩→退勤の順に、押せるボタンと状態表示が切り替わる', async ({ page }) => {
    await page.goto('/work');
    await expect(page.getByText('未出勤')).toBeVisible();
    await expect(punchBtn(page, '出勤')).toBeEnabled();
    for (const n of ['休憩開始', '休憩終了', '退勤']) await expect(punchBtn(page, n)).toBeDisabled();

    await punchBtn(page, '出勤').click();
    await expect(page.getByText('出勤を記録しました')).toBeVisible();
    await expect(page.getByText('勤務中', { exact: true }).first()).toBeVisible();
    await expect(punchBtn(page, '出勤')).toBeDisabled();
    await expect(punchBtn(page, '休憩開始')).toBeEnabled();
    await expect(punchBtn(page, '退勤')).toBeEnabled();
    await expect(punchBtn(page, '休憩終了')).toBeDisabled();

    await punchBtn(page, '休憩開始').click();
    await expect(page.getByText('休憩中')).toBeVisible();
    await expect(punchBtn(page, '休憩終了')).toBeEnabled();
    await expect(punchBtn(page, '退勤')).toBeDisabled();

    await punchBtn(page, '休憩終了').click();
    await expect(page.getByText('勤務中', { exact: true }).first()).toBeVisible();

    await punchBtn(page, '退勤').click();
    await expect(page.getByText('退勤済み')).toBeVisible();
    for (const n of ['出勤', '休憩開始', '休憩終了', '退勤']) await expect(punchBtn(page, n)).toBeDisabled();

    const rec = await db.attendance_records.findFirst({ where: { user_id: USERS.sato.id } });
    expect(rec!.work_date.toISOString().slice(0, 10)).toBe(today());
    expect(rec!.clock_in_at).not.toBeNull();
    expect(rec!.clock_out_at).not.toBeNull();
    expect(rec!.break_started_at).toBeNull();
  });

  test('今日の記録が月の一覧と集計に反映される', async ({ page }) => {
    await page.goto('/work');
    await punchBtn(page, '出勤').click();
    await expect(page.getByText('出勤を記録しました')).toBeVisible();
    await expect(page.getByText('出勤日数').locator('..')).toContainText('0日'); // 退勤するまで集計されない
    await punchBtn(page, '退勤').click();
    await expect(page.getByText('退勤済み')).toBeVisible();
    await expect(page.getByText('出勤日数').locator('..')).toContainText('1日');
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('ページを再読み込みしても、打刻の状態が保たれる', async ({ page }) => {
    await page.goto('/work');
    await punchBtn(page, '出勤').click();
    await expect(page.getByText('出勤を記録しました')).toBeVisible();
    await page.reload();
    await expect(page.getByText('勤務中', { exact: true }).first()).toBeVisible();
    await expect(punchBtn(page, '出勤')).toBeDisabled();
  });

  test('前の月・次の月に切り替えると、その月の記録（なし）が表示される', async ({ page }) => {
    await page.goto('/work');
    await punchBtn(page, '出勤').click();
    await expect(page.getByText('出勤を記録しました')).toBeVisible();
    await page.getByRole('button', { name: '前の月' }).click();
    await expect(page.getByText('この月の記録はありません')).toBeVisible();
    await page.getByRole('button', { name: '今月' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });
});

test.describe('打刻（API）', () => {
  const punch = async (c: import('@playwright/test').APIRequestContext, action: string) => c.post('/api/work/attendance/punch', { data: { action } });

  test('正しい順序でないと409（退勤から先／出勤の二重／休憩終了から先）', async ({ as }) => {
    const c = await as('sato');
    expect((await punch(c, 'clock_out')).status()).toBe(409);
    expect((await punch(c, 'break_end')).status()).toBe(409);
    expect((await punch(c, 'break_start')).status()).toBe(409);
    expect((await punch(c, 'clock_in')).status()).toBe(200);
    expect((await punch(c, 'clock_in')).status()).toBe(409);
    expect((await punch(c, 'break_end')).status()).toBe(409);
    expect((await punch(c, 'break_start')).status()).toBe(200);
    expect((await punch(c, 'break_start')).status()).toBe(409);
    expect((await punch(c, 'clock_out')).status()).toBe(409); // 休憩中は退勤できない
    expect((await punch(c, 'break_end')).status()).toBe(200);
    expect((await punch(c, 'clock_out')).status()).toBe(200);
    expect((await punch(c, 'clock_in')).status()).toBe(409); // 退勤後の再出勤はできない
  });

  test('409のときは、いま押せる打刻が返る', async ({ as }) => {
    const res = await punch(await as('sato'), 'clock_out');
    expect((await res.json()).allowed).toEqual(['clock_in']);
  });

  for (const action of ['lunch', '', 'CLOCK_IN']) {
    test(`不正なaction「${action}」は400`, async ({ as }) => {
      expect((await punch(await as('sato'), action)).status()).toBe(400);
    });
  }

  for (const role of ['suzuki', 'yamada'] as const) {
    test(`${USERS[role].name}（従業員以外）は打刻できず403`, async ({ as }) => {
      expect((await punch(await as(role), 'clock_in')).status()).toBe(403);
      expect(await db.attendance_records.count({ where: { user_id: USERS[role].id } })).toBe(0);
    });
  }

  test('休憩した分だけ break_minutes が加算される', async ({ as }) => {
    const c = await as('sato');
    await punch(c, 'clock_in');
    await punch(c, 'break_start');
    await db.attendance_records.updateMany({ where: { user_id: USERS.sato.id }, data: { break_started_at: new Date(Date.now() - 30 * 60_000) } });
    await punch(c, 'break_end');
    const rec = await db.attendance_records.findFirst({ where: { user_id: USERS.sato.id } });
    expect(rec!.break_minutes).toBeGreaterThanOrEqual(30);
    expect(rec!.break_minutes).toBeLessThanOrEqual(31);
  });

  test('日をまたいだ未退勤の勤務に、退勤を付けられる', async ({ as }) => {
    const yesterday = addDays(today(), -1);
    await db.attendance_records.create({ data: { user_id: USERS.sato.id, work_date: new Date(`${yesterday}T00:00:00Z`), clock_in_at: new Date(Date.now() - 10 * 3600_000) } });
    const c = await as('sato');
    const state = await (await c.get(`/api/work/attendance`)).json();
    expect(state.today.allowed).toEqual(['break_start', 'clock_out']);
    expect((await punch(c, 'clock_out')).status()).toBe(200);
    expect((await db.attendance_records.findFirst({ where: { user_id: USERS.sato.id } }))!.clock_out_at).not.toBeNull();
  });
});

test.describe('勤怠の集計と設定', () => {
  const day = (offset: number) => addDays(today().slice(0, 8) + '01', offset);
  async function seedDays() {
    // 3 days this month (1st-3rd): 9h with 60min break (8:00), 10h with 60min break (9:00), 9h without a break
    const base = today().slice(0, 8);
    const rows = [
      { d: `${base}01`, i: '00:00', o: '09:00', b: 60 },
      { d: `${base}02`, i: '00:00', o: '10:00', b: 60 },
      { d: `${base}03`, i: '00:00', o: '09:00', b: 0 },
    ];
    for (const r of rows) {
      await db.attendance_records.create({ data: { user_id: USERS.sato.id, work_date: new Date(`${r.d}T00:00:00Z`), clock_in_at: new Date(`${r.d}T${r.i}:00Z`), clock_out_at: new Date(`${r.d}T${r.o}:00Z`), break_minutes: r.b } });
    }
  }

  test('日数・総労働時間・残業を計算する（休憩の打刻がない日は自動休憩を引く）', async ({ as }) => {
    await seedDays();
    const body = await (await (await as('sato')).get(`/api/work/attendance?month=${month()}`)).json();
    // 8:00 + 9:00 + (9:00 - auto 60min = 8:00) = 25:00 ; overtime: 0 + 60 + 0
    expect(body.summary).toEqual({ days: 3, workedMinutes: 1500, overtimeMinutes: 60 });
    expect(body.records.map((r: { worked_minutes: number }) => r.worked_minutes)).toEqual([480, 540, 480]);
  });

  test('画面にも同じ集計が出る', async ({ browser }) => {
    await seedDays();
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await expect(page.getByText('出勤日数').locator('..')).toContainText('3日');
    await expect(page.getByText('総労働時間').locator('..')).toContainText('25:00');
    await expect(page.getByText('残業時間').locator('..')).toContainText('1:00');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await ctx.close();
  });

  test('管理者が所定労働時間を変えると、残業の集計が変わる', async ({ as }) => {
    await seedDays();
    const admin = await as('admin');
    expect((await admin.put('/api/work/settings', { data: { daily_minutes: 420, auto_break_minutes: 60 } })).status()).toBe(200);
    const body = await (await (await as('sato')).get(`/api/work/attendance?month=${month()}`)).json();
    expect(body.settings).toEqual({ daily_minutes: 420, auto_break_minutes: 60 });
    expect(body.summary.overtimeMinutes).toBe(60 + 120 + 60);
  });

  test('自動休憩を0にすると、休憩なしの日は差し引かれない', async ({ as }) => {
    await seedDays();
    await (await as('admin')).put('/api/work/settings', { data: { daily_minutes: 480, auto_break_minutes: 0 } });
    const body = await (await (await as('sato')).get(`/api/work/attendance?month=${month()}`)).json();
    expect(body.summary.workedMinutes).toBe(480 + 540 + 540);
  });

  for (const [label, data] of [
    ['所定労働時間が負', { daily_minutes: -1, auto_break_minutes: 60 }],
    ['所定労働時間が1441分', { daily_minutes: 1441, auto_break_minutes: 60 }],
    ['自動休憩が241分', { daily_minutes: 480, auto_break_minutes: 241 }],
    ['小数', { daily_minutes: 480.5, auto_break_minutes: 60 }],
    ['文字列', { daily_minutes: '480', auto_break_minutes: 60 }],
    ['項目不足', { daily_minutes: 480 }],
  ] as const) {
    test(`設定の保存: ${label} は400`, async ({ as }) => {
      expect((await (await as('admin')).put('/api/work/settings', { data })).status()).toBe(400);
    });
  }

  test('設定の変更は管理者だけ。誰でも読める', async ({ as }) => {
    expect((await (await as('sato')).put('/api/work/settings', { data: { daily_minutes: 1, auto_break_minutes: 1 } })).status()).toBe(403);
    expect((await (await as('sato')).get('/api/work/settings')).status()).toBe(200);
  });

  test('画面の「勤怠の設定」から保存できる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await tab(page, '管理').click();
    await expect(page.getByText('勤怠の設定')).toBeVisible();
    await field(page, '所定労働時間').fill('450');
    await field(page, '自動休憩').fill('45');
    await page.getByRole('button', { name: '設定を保存' }).click();
    await expect(page.getByText('勤怠の設定を保存しました')).toBeVisible();
    expect((await (await ctx.request.get('/api/work/settings')).json())).toEqual({ daily_minutes: 450, auto_break_minutes: 45 });
    await ctx.close();
  });
});

test.describe('勤怠の確認・修正（管理者）', () => {
  const put = (c: import('@playwright/test').APIRequestContext, data: object) => c.put('/api/work/attendance', { data });
  const base = () => ({ userId: USERS.sato.id, work_date: today(), clock_in_at: `${today()}T00:00:00Z`, clock_out_at: `${today()}T09:00:00Z`, break_minutes: 60, note: '修正' });

  test('管理者は従業員の勤怠を追加・修正でき、「修正済」の印が付く', async ({ as }) => {
    const admin = await as('admin');
    expect((await put(admin, base())).status()).toBe(200);
    expect((await put(admin, { ...base(), clock_out_at: `${today()}T10:00:00Z`, note: '再修正' })).status()).toBe(200);
    expect(await db.attendance_records.count({ where: { user_id: USERS.sato.id } })).toBe(1);
    const body = await (await (await as('sato')).get('/api/work/attendance')).json();
    expect(body.records[0]).toMatchObject({ edited: true, note: '再修正', worked_minutes: 540 });
  });

  test('一般ユーザーは勤怠を修正・削除できない', async ({ as }) => {
    const c = await as('sato');
    expect((await put(c, base())).status()).toBe(403);
    expect((await c.delete('/api/work/attendance?id=x')).status()).toBe(403);
  });

  for (const [label, patch] of [
    ['退勤が出勤より前', { clock_out_at: `${today()}T00:00:00Z`, clock_in_at: `${today()}T05:00:00Z` }],
    ['出勤なしの退勤', { clock_in_at: null }],
    ['休憩が負', { break_minutes: -5 }],
    ['休憩が1441分', { break_minutes: 1441 }],
    ['日付が不正', { work_date: '2026-02-30' }],
    ['日付の形式が不正', { work_date: '10/20' }],
    ['備考が501文字', { note: 'あ'.repeat(501) }],
  ] as const) {
    test(`修正: ${label} は400`, async ({ as }) => {
      expect((await put(await as('admin'), { ...base(), ...patch })).status()).toBe(400);
    });
  }

  test('修正: 存在しないユーザーは404', async ({ as }) => {
    expect((await put(await as('admin'), { ...base(), userId: 'nobody' })).status()).toBe(404);
  });

  test('管理者は他人の勤怠を月ごとに見られ、一般ユーザーは見られない', async ({ as }) => {
    await (await as('admin')).put('/api/work/attendance', { data: base() });
    const ok = await (await as('admin')).get(`/api/work/attendance?userId=${USERS.sato.id}&month=${month()}`);
    expect((await ok.json()).user.name).toBe('佐藤');
    expect((await (await as('tanaka')).get(`/api/work/attendance?userId=${USERS.sato.id}`)).status()).toBe(403);
  });

  test('従業員以外は自分の勤怠一覧を開けない（403）。月の指定が不正なら400', async ({ as }) => {
    expect((await (await as('suzuki')).get('/api/work/attendance')).status()).toBe(403);
    expect((await (await as('sato')).get('/api/work/attendance?month=2026-13')).status()).toBe(400);
    expect((await (await as('sato')).get('/api/work/attendance?month=abc')).status()).toBe(400);
  });

  test('削除すると記録が消え、監査ログに残る', async ({ as }) => {
    const admin = await as('admin');
    const id = (await (await put(admin, base())).json()).id;
    expect((await admin.delete(`/api/work/attendance?id=${id}`)).status()).toBe(200);
    expect(await db.attendance_records.findUnique({ where: { id } })).toBeNull();
    expect(await db.audit_logs.count({ where: { action_type: 'attendance_delete', target_id: id } })).toBe(1);
    expect((await admin.delete(`/api/work/attendance?id=${id}`)).status()).toBe(404);
  });

  test('画面: 管理者が従業員を選んで勤怠を修正する', async ({ browser }) => {
    await db.attendance_records.create({ data: { user_id: USERS.sato.id, work_date: new Date(`${today()}T00:00:00Z`), clock_in_at: new Date(`${today()}T00:00:00Z`), clock_out_at: new Date(`${today()}T09:00:00Z`), break_minutes: 60 } });
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await tab(page, '管理').click();
    await page.getByRole('button', { name: '勤怠の確認' }).click();
    await page.locator('select').first().selectOption(USERS.sato.id);
    await expect(page.getByText('佐藤 さんの勤怠')).toBeVisible();
    await page.locator('tbody').getByRole('button', { name: '修正' }).click();
    await field(page, '休憩（分）').fill('30');
    await field(page, '備考（修正理由など）').fill('休憩の打ち忘れ');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect(page.locator('tbody')).toContainText('休憩の打ち忘れ');
    await expect(page.locator('tbody')).toContainText('修正済');
    await ctx.close();
  });
});

test.describe('業務報告書（業務委託）', () => {
  const body = (o: object = {}) => ({ report_date: today(), title: uniq('作業報告'), content: '実装を行いました', hours: 6.5, ...o });

  test('従業員・役員は提出できない（403）', async ({ as }) => {
    for (const role of ['sato', 'yamada'] as const) expect((await (await as(role)).post('/api/work/reports', { data: body() })).status()).toBe(403);
  });

  for (const [label, patch] of [
    ['件名が空', { title: '  ' }],
    ['内容が空', { content: '' }],
    ['件名が201文字', { title: 'あ'.repeat(201) }],
    ['日付が不正', { report_date: '2026-13-01' }],
    ['稼働時間が負', { hours: -1 }],
    ['稼働時間が1000h', { hours: 1000 }],
  ] as const) {
    test(`提出: ${label} は400`, async ({ as }) => {
      expect((await (await as('suzuki')).post('/api/work/reports', { data: body(patch) })).status()).toBe(400);
    });
  }

  test('稼働時間は省略できる', async ({ as }) => {
    const res = await (await as('suzuki')).post('/api/work/reports', { data: body({ hours: null }) });
    expect(res.status()).toBe(201);
  });

  test('画面から提出・編集・削除できる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.suzuki, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    const title = uniq('10月第3週の作業報告');
    await page.getByRole('button', { name: '＋ 報告書を作成' }).click();
    await page.getByPlaceholder(/10月第3週/).fill(title);
    await page.getByPlaceholder('実施した業務、成果、課題、次回の予定など').fill('・LPの修正\n・フォームの検証');
    await page.locator('input[type=number]').fill('32.5');
    await page.getByRole('button', { name: '提出' }).click();
    await expect(page.getByText('報告書を提出しました')).toBeVisible();
    await expect(page.getByText('提出件数').locator('..')).toContainText('1件');
    await expect(page.getByText('報告した稼働時間').locator('..')).toContainText('32.5h');

    await page.getByRole('button', { name: new RegExp(title) }).click();
    await expect(page.getByText('・LPの修正')).toBeVisible();
    await page.getByRole('button', { name: '編集' }).click();
    await page.locator('input[type=number]').fill('30');
    await page.getByRole('button', { name: '更新' }).click();
    await expect(page.getByText('報告した稼働時間').locator('..')).toContainText('30h');

    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '削除' }).click();
    await expect(page.getByText('この月の報告書はありません')).toBeVisible();
    expect(await db.work_reports.count()).toBe(0);
    await ctx.close();
  });

  test('他の業務委託者の報告書は編集できず、管理者は閲覧・削除だけできる', async ({ as }) => {
    await setWorkerType(USERS.tanaka.id, 'contractor');
    const id = (await (await (await as('suzuki')).post('/api/work/reports', { data: body() })).json()).id;
    expect((await (await as('tanaka')).patch(`/api/work/reports/${id}`, { data: body() })).status()).toBe(403);
    expect((await (await as('tanaka')).delete(`/api/work/reports/${id}`)).status()).toBe(403);
    expect((await (await as('admin')).patch(`/api/work/reports/${id}`, { data: body() })).status()).toBe(403);
    const listed = await (await (await as('admin')).get(`/api/work/reports?month=${month()}`)).json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].user.name).toBe('鈴木');
    expect((await (await as('admin')).delete(`/api/work/reports/${id}`)).status()).toBe(200);
  });

  test('業務委託者には自分の報告書だけが見える（他の人の分は一覧に出ない）', async ({ as }) => {
    await setWorkerType(USERS.tanaka.id, 'contractor');
    await (await as('suzuki')).post('/api/work/reports', { data: body({ title: '鈴木の報告' }) });
    await (await as('tanaka')).post('/api/work/reports', { data: body({ title: '田中の報告' }) });
    const mine = (await (await (await as('suzuki')).get(`/api/work/reports?month=${month()}&userId=${USERS.tanaka.id}`)).json()).items;
    expect(mine.map((r: { title: string }) => r.title)).toEqual(['鈴木の報告']);
  });

  test('従業員は報告書の一覧を開けない（403）', async ({ as }) => {
    expect((await (await as('sato')).get('/api/work/reports')).status()).toBe(403);
  });

  test('月ごとに絞り込め、合計稼働時間が出る', async ({ as }) => {
    const c = await as('suzuki');
    await c.post('/api/work/reports', { data: body({ hours: 4 }) });
    await c.post('/api/work/reports', { data: body({ hours: 2.5 }) });
    await c.post('/api/work/reports', { data: body({ report_date: '2020-01-15', hours: 99 }) });
    const now = await (await c.get(`/api/work/reports?month=${month()}`)).json();
    expect(now.items).toHaveLength(2);
    expect(now.total_hours).toBe(6.5);
    expect((await (await c.get('/api/work/reports?month=2020-01')).json()).total_hours).toBe(99);
    expect((await c.get('/api/work/reports?month=2020-99')).status()).toBe(400);
  });
});

test.describe('給与・報酬の明細', () => {
  const slip = (userId: string, o: object = {}) => ({
    userId, pay_month: month(), title: '給与', status: 'planned',
    items: [{ kind: 'earning', label: '基本給', amount: 300000 }, { kind: 'earning', label: '通勤手当', amount: 12000 }, { kind: 'deduction', label: '社会保険料', amount: 46800 }], ...o,
  });

  test('管理者が登録すると、手取りは 支給−控除 になる', async ({ as }) => {
    const res = await (await as('admin')).post('/api/work/payslips', { data: slip(USERS.sato.id) });
    expect(res.status()).toBe(201);
    const items = (await (await (await as('sato')).get('/api/work/payslips?mine=1')).json()).items;
    expect(items[0]).toMatchObject({ earnings: 312000, deductions: 46800, net: 265200, status: 'planned' });
  });

  test('一般ユーザーは明細の登録・変更・削除ができない', async ({ as }) => {
    const id = (await (await (await as('admin')).post('/api/work/payslips', { data: slip(USERS.sato.id) })).json()).id;
    const c = await as('sato');
    expect((await c.post('/api/work/payslips', { data: slip(USERS.sato.id) })).status()).toBe(403);
    expect((await c.put(`/api/work/payslips/${id}`, { data: { ...slip(USERS.sato.id), userId: undefined } })).status()).toBe(403);
    expect((await c.delete(`/api/work/payslips/${id}`)).status()).toBe(403);
  });

  test('自分の明細だけが見え、他人のuserIdを指定しても他人の分は返らない', async ({ as }) => {
    const admin = await as('admin');
    await admin.post('/api/work/payslips', { data: slip(USERS.sato.id) });
    await admin.post('/api/work/payslips', { data: slip(USERS.tanaka.id, { title: '田中の給与' }) });
    const sato = await (await (await as('sato')).get(`/api/work/payslips?userId=${USERS.tanaka.id}`)).json();
    expect(sato.items).toHaveLength(1);
    expect(sato.items[0].user.name).toBe('佐藤');
    expect(JSON.stringify(sato)).not.toContain('田中の給与');
  });

  test('管理者は全員分を見られ、userIdで絞り込める。mine=1なら自分の分だけ', async ({ as }) => {
    const admin = await as('admin');
    await admin.post('/api/work/payslips', { data: slip(USERS.sato.id) });
    await admin.post('/api/work/payslips', { data: slip(USERS.tanaka.id) });
    expect((await (await admin.get('/api/work/payslips')).json()).items).toHaveLength(2);
    expect((await (await admin.get(`/api/work/payslips?userId=${USERS.tanaka.id}`)).json()).items).toHaveLength(1);
    expect((await (await admin.get('/api/work/payslips?mine=1')).json()).items).toHaveLength(0);
  });

  for (const [label, patch] of [
    ['項目が空', { items: [] }],
    ['金額が負', { items: [{ kind: 'earning', label: '基本給', amount: -1 }] }],
    ['金額が小数', { items: [{ kind: 'earning', label: '基本給', amount: 1.5 }] }],
    ['項目名が空', { items: [{ kind: 'earning', label: '', amount: 1 }] }],
    ['種別が不正', { items: [{ kind: 'bonus', label: 'x', amount: 1 }] }],
    ['対象月が不正', { pay_month: '2026-13' }],
    ['状態が不正', { status: 'draft' }],
    ['支払日が不正', { pay_date: '2026-02-30' }],
    ['項目が51件', { items: Array.from({ length: 51 }, (_, i) => ({ kind: 'earning', label: `x${i}`, amount: 1 })) }],
  ] as const) {
    test(`登録: ${label} は400`, async ({ as }) => {
      expect((await (await as('admin')).post('/api/work/payslips', { data: slip(USERS.sato.id, patch) })).status()).toBe(400);
    });
  }

  test('登録: 存在しないユーザーは404', async ({ as }) => {
    expect((await (await as('admin')).post('/api/work/payslips', { data: slip('nobody') })).status()).toBe(404);
  });

  test('当月のサマリー: 支払予定額と支払済額を分けて集計する', async ({ as }) => {
    const admin = await as('admin');
    await admin.post('/api/work/payslips', { data: slip(USERS.sato.id) });
    await admin.post('/api/work/payslips', { data: slip(USERS.sato.id, { title: '賞与', status: 'paid', items: [{ kind: 'earning', label: '賞与', amount: 100000 }] }) });
    const s = (await (await (await as('sato')).get('/api/work/payslips?mine=1')).json()).summary;
    expect(s).toEqual({ month: month(), planned_total: 265200, paid_total: 100000, count: 2 });
  });

  test('支払済にすると支払日が入り、更新は監査ログに残る', async ({ as }) => {
    const admin = await as('admin');
    const id = (await (await admin.post('/api/work/payslips', { data: slip(USERS.sato.id) })).json()).id;
    const put = await admin.put(`/api/work/payslips/${id}`, { data: { pay_month: month(), title: '給与', status: 'paid', items: [{ kind: 'earning', label: '基本給', amount: 1000 }] } });
    expect(put.status()).toBe(200);
    const row = await db.payslips.findUnique({ where: { id }, include: { items: true } });
    expect(row!.status).toBe('paid');
    expect(row!.pay_date!.toISOString().slice(0, 10)).toBe(today());
    expect(row!.items).toHaveLength(1);
    expect(await db.audit_logs.count({ where: { action_type: 'payslip_update', target_id: id } })).toBe(1);
  });

  test('明細を削除すると項目も消える', async ({ as }) => {
    const admin = await as('admin');
    const id = (await (await admin.post('/api/work/payslips', { data: slip(USERS.sato.id) })).json()).id;
    expect((await admin.delete(`/api/work/payslips/${id}`)).status()).toBe(200);
    expect(await db.payslip_items.count({ where: { payslip_id: id } })).toBe(0);
    expect((await admin.delete(`/api/work/payslips/${id}`)).status()).toBe(404);
  });

  test('画面: 本人の「給与明細」に支払予定額と内訳が出る', async ({ browser, as }) => {
    await (await as('admin')).post('/api/work/payslips', { data: slip(USERS.sato.id) });
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await tab(page, '給与明細').click();
    await expect(page.getByText(/の支払予定額/).locator('..')).toContainText('¥265,200');
    await page.getByRole('button', { name: /手取り/ }).first().click();
    await expect(page.getByText('社会保険料')).toBeVisible();
    await expect(page.getByText('差引支給額（手取り）').last()).toBeVisible();
    await expect(page.getByRole('button', { name: '編集' })).toHaveCount(0); // 本人には編集ボタンがない
    await ctx.close();
  });

  test('画面: 管理者が明細を登録し、手取りの自動計算を確認できる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await tab(page, '管理').click();
    await page.getByRole('button', { name: '給与・報酬の管理' }).click();
    await page.getByRole('button', { name: '＋ 明細を登録' }).click();
    await page.locator('select').nth(1).selectOption(USERS.sato.id);
    const amounts = page.locator('input[placeholder="0"]');
    await amounts.nth(0).fill('320000');
    await amounts.nth(1).fill('48000');
    await expect(page.getByText('差引支給額（手取り）').last().locator('..')).toContainText('¥272,000');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('明細を保存しました')).toBeVisible();
    expect(await db.payslips.count({ where: { user_id: USERS.sato.id } })).toBe(1);
    await ctx.close();
  });

  test('役員・業務委託にも明細（報酬）を登録でき、本人だけが見える', async ({ as }) => {
    const admin = await as('admin');
    await admin.post('/api/work/payslips', { data: slip(USERS.suzuki.id, { title: '業務委託報酬' }) });
    expect((await (await (await as('suzuki')).get('/api/work/payslips?mine=1')).json()).items).toHaveLength(1);
    expect((await (await (await as('yamada')).get('/api/work/payslips?mine=1')).json()).items).toHaveLength(0);
  });
});
