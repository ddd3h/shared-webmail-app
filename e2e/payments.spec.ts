import { test, expect, uniq } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { HTML_FILE, PDF, PNG, makePayment, makeVendor } from './helpers/factories';
import { jstDate, resetPayments } from './helpers/seed';
import { field } from './helpers/ui';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetPayments(); });
test.afterEach(async () => { await db.users.updateMany({ where: { id: USERS.admin2.id }, data: { role: 'admin' } }); });

const vendorBody = (o: Record<string, unknown> = {}) => ({
  name: uniq('取引先'), bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '123', account_type: 'ordinary',
  account_number: String(2000000 + Math.floor(Math.random() * 7999999)), account_holder: 'カ）テスト', ...o,
});
const form = (vendorId: string, o: Record<string, string> = {}) => ({ vendor_id: vendorId, title: uniq('外注費'), amount: '110000', due_date: jstDate(7), ...o });

test.describe('取引先', () => {
  test('誰でも登録できるが、一般ユーザーが登録した口座は未確認になる', async ({ as }) => {
    const res = await (await as('sato')).post('/api/payments/vendors', { data: vendorBody() });
    expect(res.status()).toBe(201);
    const v = await db.payment_vendors.findUnique({ where: { id: (await res.json()).id } });
    expect(v!.verified_at).toBeNull();
    expect(v!.account_number_enc).not.toMatch(/^\d+$/);
  });

  test('管理者が登録した口座は最初から確認済になる', async ({ as }) => {
    const res = await (await as('admin')).post('/api/payments/vendors', { data: vendorBody() });
    expect((await db.payment_vendors.findUnique({ where: { id: (await res.json()).id } }))!.verified_at).not.toBeNull();
  });

  test('一般ユーザーには口座番号・名義が見えず、末尾4桁だけ。管理者と経理担当には全部見える', async ({ as }) => {
    const v = await makeVendor({ accountNumber: '9988776' });
    const body = async (r: 'sato' | 'admin' | 'keiri') => JSON.stringify(await (await (await as(r)).get('/api/payments/vendors')).json());
    const s = await body('sato');
    expect(s).not.toContain('9988776');
    expect(s).toContain('8776');
    expect(s).not.toContain('カ）テスト');
    for (const r of ['admin', 'keiri'] as const) expect(await body(r)).toContain('9988776');
    void v;
  });

  const bad: [string, Record<string, unknown>][] = [
    ['名前が空', { name: ' ' }], ['銀行コードが3桁', { bank_code: '001' }], ['支店コードが2桁', { branch_code: '12' }], ['口座番号が3桁', { account_number: '123' }],
    ['口座番号が9桁', { account_number: '123456789' }], ['口座番号に文字', { account_number: '12ab567' }], ['預金種目が不正', { account_type: 'foo' }], ['名義が空', { account_holder: '' }],
  ];
  for (const [label, over] of bad) {
    test(`不正な入力は登録できない: ${label}`, async ({ as }) => {
      expect((await (await as('admin')).post('/api/payments/vendors', { data: vendorBody(over) })).status()).toBe(400);
      expect(await db.payment_vendors.count()).toBe(0);
    });
  }

  test('同じ口座の二重登録はできないが、末尾が同じだけの別口座は登録できる', async ({ as }) => {
    const admin = await as('admin');
    const first = vendorBody({ account_number: '1234567' });
    expect((await admin.post('/api/payments/vendors', { data: first })).status()).toBe(201);
    const dup = await admin.post('/api/payments/vendors', { data: { ...first, name: '別名の同じ口座' } });
    expect(dup.status()).toBe(409);
    expect((await admin.post('/api/payments/vendors', { data: { ...first, name: '末尾だけ同じ', account_number: '9991234567'.slice(-8) } })).status()).toBe(201);
  });

  test('口座情報を変更すると確認済が外れる。名前だけの変更では外れない', async ({ as }) => {
    const v = await makeVendor({ accountNumber: '1234567' });
    const admin = await as('admin');
    const base = { name: v.name, bank_name: v.bank_name, bank_code: '0001', branch_name: v.branch_name, branch_code: '123', account_type: 'ordinary', account_number: '1234567', account_holder: v.account_holder };
    expect((await admin.put(`/api/payments/vendors/${v.id}`, { data: { ...base, name: '名称変更のみ' } })).status()).toBe(200);
    expect((await db.payment_vendors.findUnique({ where: { id: v.id } }))!.verified_at).not.toBeNull();
    const res = await admin.put(`/api/payments/vendors/${v.id}`, { data: { ...base, account_number: '7654321' } });
    expect((await res.json()).verification_cleared).toBe(true);
    expect((await db.payment_vendors.findUnique({ where: { id: v.id } }))!.verified_at).toBeNull();
  });

  test('編集・確認は管理者だけ（経理担当・一般ユーザーは403）', async ({ as }) => {
    const v = await makeVendor({ verified: false });
    for (const r of ['sato', 'keiri'] as const) {
      const c = await as(r);
      expect((await c.put(`/api/payments/vendors/${v.id}`, { data: vendorBody() })).status(), r).toBe(403);
      expect((await c.post(`/api/payments/vendors/${v.id}/verify`)).status(), r).toBe(403);
    }
    expect((await (await as('admin')).post(`/api/payments/vendors/${v.id}/verify`)).status()).toBe(200);
  });
});

test.describe('振込申請', () => {
  test('請求書つきで申請でき、承認待ちになる', async ({ as }) => {
    const v = await makeVendor();
    const res = await (await as('sato')).post('/api/payments', { multipart: { ...form(v.id), invoice_number: 'INV-1', file: PDF } });
    expect(res.status()).toBe(201);
    const r = await db.payment_requests.findUnique({ where: { id: (await res.json()).id }, include: { documents: true } });
    expect(r).toMatchObject({ status: 'pending', user_id: USERS.sato.id, amount: 110000 });
    expect(r!.documents).toHaveLength(1);
  });

  const bad: [string, Record<string, string>][] = [
    ['金額が0', { amount: '0' }], ['金額がマイナス', { amount: '-5' }], ['金額が小数', { amount: '10.5' }], ['金額が10億超', { amount: '1000000001' }],
    ['件名が空', { title: ' ' }], ['期日が不正', { due_date: '2026-02-30' }], ['控除が請求金額を超える', { amount: '1000', deduction_amount: '1001' }],
    ['先方負担の手数料と控除の合計が超える', { amount: '1000', deduction_amount: '800', fee: '300', fee_bearer: 'vendor' }], ['手数料の負担者が不正', { fee_bearer: 'both' }],
  ];
  for (const [label, over] of bad) {
    test(`不正な申請は400: ${label}`, async ({ as }) => {
      const v = await makeVendor();
      expect((await (await as('sato')).post('/api/payments', { multipart: form(v.id, over) })).status()).toBe(400);
      expect(await db.payment_requests.count()).toBe(0);
    });
  }

  test('当方負担の手数料は、控除と合わせて請求金額を超えてもよい（振込額から引かないため）', async ({ as }) => {
    const v = await makeVendor();
    expect((await (await as('sato')).post('/api/payments', { multipart: form(v.id, { amount: '1000', deduction_amount: '900', fee: '500', fee_bearer: 'us' }) })).status()).toBe(201);
  });

  test('存在しない・無効な取引先は申請できない', async ({ as }) => {
    const inactive = await makeVendor({ active: false });
    const sato = await as('sato');
    expect((await sato.post('/api/payments', { multipart: form('nope') })).status()).toBe(400);
    expect((await sato.post('/api/payments', { multipart: form(inactive.id) })).status()).toBe(400);
  });

  test('請求書はPDF・画像だけ。HTMLは拒否、6枚目も拒否', async ({ as }) => {
    const v = await makeVendor();
    const sato = await as('sato');
    expect((await sato.post('/api/payments', { multipart: { ...form(v.id), file: HTML_FILE } })).status()).toBe(400);
    expect((await sato.post('/api/payments', { multipart: { ...form(v.id), file: PNG } })).status()).toBe(201);
  });

  test('同じ取引先・同じ請求書番号は二重に申請できない（却下されたものは除く）', async ({ as }) => {
    const v = await makeVendor();
    const sato = await as('sato');
    expect((await sato.post('/api/payments', { multipart: { ...form(v.id), invoice_number: 'INV-9' } })).status()).toBe(201);
    expect((await sato.post('/api/payments', { multipart: { ...form(v.id), invoice_number: 'INV-9' } })).status()).toBe(409);
    const other = await makeVendor();
    expect((await sato.post('/api/payments', { multipart: { ...form(other.id), invoice_number: 'INV-9' } })).status()).toBe(201);
    await db.payment_requests.updateMany({ where: { vendor_id: v.id }, data: { status: 'rejected' } });
    expect((await sato.post('/api/payments', { multipart: { ...form(v.id), invoice_number: 'INV-9' } })).status()).toBe(201);
  });

  test('申請者は承認待ちの間だけ編集・取り下げができ、他人のものは触れない', async ({ as }) => {
    const v = await makeVendor();
    const p = await makePayment({ role: 'sato', vendorId: v.id, status: 'pending' });
    const edit = { vendor_id: v.id, title: '修正後', amount: 120000, due_date: jstDate(10) };
    expect((await (await as('tanaka')).patch(`/api/payments/${p.id}`, { data: edit })).status()).toBe(403);
    expect((await (await as('tanaka')).delete(`/api/payments/${p.id}`)).status()).toBe(403);
    expect((await (await as('sato')).patch(`/api/payments/${p.id}`, { data: edit })).status()).toBe(200);
    expect((await db.payment_requests.findUnique({ where: { id: p.id } }))!.title).toBe('修正後');
    expect((await (await as('sato')).delete(`/api/payments/${p.id}`)).status()).toBe(200);
    const approved = await makePayment({ role: 'sato', vendorId: v.id, status: 'approved' });
    expect((await (await as('sato')).patch(`/api/payments/${approved.id}`, { data: edit })).status()).toBe(409);
    expect((await (await as('sato')).delete(`/api/payments/${approved.id}`)).status()).toBe(409);
  });

  test('一般ユーザーは自分の申請だけが見え、scope=all（全員分）は使えない。経理担当は全員分を見られる', async ({ as }) => {
    const v = await makeVendor();
    await makePayment({ role: 'sato', vendorId: v.id, title: '佐藤の申請' });
    await makePayment({ role: 'tanaka', vendorId: v.id, title: '田中の申請' });
    const text = JSON.stringify(await (await (await as('sato')).get('/api/payments')).json());
    expect(text).toContain('佐藤の申請');
    expect(text).not.toContain('田中の申請');
    expect((await (await as('sato')).get('/api/payments?scope=all')).status()).toBe(403);
    const keiri = JSON.stringify(await (await (await as('keiri')).get('/api/payments?scope=all')).json());
    expect(keiri).toContain('田中の申請');
  });
});

test.describe('承認・却下', () => {
  test('管理者だけが承認でき、却下にはコメントが必要', async ({ as }) => {
    const v = await makeVendor();
    const p = await makePayment({ role: 'sato', vendorId: v.id });
    expect((await (await as('sato')).post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } })).status()).toBe(403);
    const admin = await as('admin');
    expect((await admin.post(`/api/payments/${p.id}/review`, { data: { action: 'reject' } })).status()).toBe(400);
    expect((await admin.post(`/api/payments/${p.id}/review`, { data: { action: 'reject', comment: '金額が違います' } })).status()).toBe(200);
    expect((await db.payment_requests.findUnique({ where: { id: p.id } }))).toMatchObject({ status: 'rejected', review_comment: '金額が違います' });
  });

  test('口座が未確認の取引先宛の申請は承認できない（却下はできる）', async ({ as }) => {
    const v = await makeVendor({ verified: false });
    const p = await makePayment({ role: 'sato', vendorId: v.id });
    const admin = await as('admin');
    const res = await admin.post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe('vendor_unverified');
    expect((await admin.post(`/api/payments/${p.id}/review`, { data: { action: 'reject', comment: '口座確認前' } })).status()).toBe(200);
  });

  test('管理者が2人いるときは、自分の申請を自分で承認できない', async ({ as }) => {
    const v = await makeVendor();
    const p = await makePayment({ role: 'admin', vendorId: v.id });
    expect((await (await as('admin')).post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } })).status()).toBe(403);
    expect((await (await as('admin2')).post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } })).status()).toBe(200);
  });

  test('管理者が1人だけなら、自分の申請を承認できる', async ({ as }) => {
    await db.users.update({ where: { id: USERS.admin2.id }, data: { role: 'user' } });
    const v = await makeVendor();
    const p = await makePayment({ role: 'admin', vendorId: v.id });
    expect((await (await as('admin')).post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } })).status()).toBe(200);
  });

  test('すでに処理済みの申請は再度承認・却下できない（409）。同時の承認も1回だけ', async ({ as }) => {
    const v = await makeVendor();
    const p = await makePayment({ role: 'sato', vendorId: v.id });
    const [a, b] = await Promise.all([(await as('admin')).post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } }), (await as('admin2')).post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } })]);
    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
    expect((await (await as('admin')).post(`/api/payments/${p.id}/review`, { data: { action: 'reject', comment: 'x' } })).status()).toBe(409);
  });

  test('却下された申請は直して再申請でき、承認待ちに戻る', async ({ as }) => {
    const v = await makeVendor();
    const p = await makePayment({ role: 'sato', vendorId: v.id, status: 'rejected', comment: '金額が違います' });
    const res = await (await as('sato')).patch(`/api/payments/${p.id}`, { data: { vendor_id: v.id, title: '修正', amount: 100000, due_date: jstDate(5) } });
    expect(res.status()).toBe(200);
    expect(await db.payment_requests.findUnique({ where: { id: p.id } })).toMatchObject({ status: 'pending', review_comment: null, reviewed_by_id: null });
  });
});

test.describe('振込済の記録とCSV', () => {
  test('経理担当・管理者は振込済にでき、承認前・口座未確認の申請はスキップされる', async ({ as }) => {
    const ok = await makeVendor();
    const unverified = await makeVendor({ verified: false });
    const a = await makePayment({ vendorId: ok.id, status: 'approved' });
    const b = await makePayment({ vendorId: ok.id, status: 'pending' });
    const c = await makePayment({ vendorId: unverified.id, status: 'approved' });
    const res = await (await as('keiri')).post('/api/payments/mark-paid', { data: { ids: [a.id, b.id, c.id], paid_date: jstDate(0), note: '総合振込' } });
    expect(await res.json()).toEqual({ paid: 1, skipped: 2 });
    expect(await db.payment_requests.findUnique({ where: { id: a.id } })).toMatchObject({ status: 'paid', paid_note: '総合振込', paid_by_id: USERS.keiri.id });
    expect((await db.payment_requests.findUnique({ where: { id: b.id } }))!.status).toBe('pending');
  });

  test('一般ユーザーは振込済にできない。同じ申請を2回記録しても1回だけ', async ({ as }) => {
    const v = await makeVendor();
    const p = await makePayment({ vendorId: v.id, status: 'approved' });
    expect((await (await as('sato')).post('/api/payments/mark-paid', { data: { ids: [p.id] } })).status()).toBe(403);
    const admin = await as('admin');
    expect((await (await admin.post('/api/payments/mark-paid', { data: { ids: [p.id] } })).json()).paid).toBe(1);
    expect((await (await admin.post('/api/payments/mark-paid', { data: { ids: [p.id] } })).json()).paid).toBe(0);
  });

  test('ids が空・日付が不正なら400', async ({ as }) => {
    const admin = await as('admin');
    expect((await admin.post('/api/payments/mark-paid', { data: { ids: [] } })).status()).toBe(400);
    expect((await admin.post('/api/payments/mark-paid', { data: { ids: ['a'], paid_date: '2026-13-01' } })).status()).toBe(400);
  });

  test('CSV: 承認済・確認済の分だけ、振込額と口座番号を含む。一般ユーザーは403', async ({ as }) => {
    const v = await makeVendor({ accountNumber: '3141592', name: '=cmd|calc' });
    await makePayment({ vendorId: v.id, status: 'approved', amount: 110000, deduction: 11000, title: '=HYPERLINK("x")' });
    await makePayment({ vendorId: v.id, status: 'pending', title: '承認前' });
    expect((await (await as('sato')).get('/api/payments/export')).status()).toBe(403);
    const logged = () => db.audit_logs.count({ where: { action_type: 'payment_export' } });
    const before = await logged();
    const res = await (await as('keiri')).get('/api/payments/export');
    expect(res.headers()['content-type']).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('3141592');
    expect(csv).toContain('99000');
    expect(csv).not.toContain('承認前');
    // formula injection: nothing may start with = + - @
    for (const line of csv.split(/\r?\n/).slice(1)) for (const cell of line.split(',')) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+@]/);
    expect(await logged()).toBe(before + 1);
  });
});

test.describe('画面', () => {
  test.describe('申請者', () => {
    test.use({ storageState: AUTH.sato });
    test('取引先を選んで振込を申請すると、承認待ちとして一覧に出て、振込額の内訳が計算される', async ({ page }) => {
      const v = await makeVendor({ name: '画面テスト商事' });
      const title = uniq('10月分 開発委託費');
      await page.goto('/payments');
      await expect(page.getByRole('heading', { level: 1, name: '振込申請' })).toBeVisible();
      await page.getByRole('button', { name: '＋ 振込を申請' }).click();
      await field(page, '振込先').selectOption(v.id);
      await field(page, '件名・内容').fill(title);
      await field(page, '請求金額').fill('110000');
      await field(page, '控除').fill('11000');
      await field(page, '支払期日').fill(jstDate(7));
      await expect(page.getByText('¥99,000').first()).toBeVisible(); // 振込額 = 請求金額 − 控除
      await page.getByRole('button', { name: '申請する' }).click();
      await expect(page.getByText('振込を申請しました')).toBeVisible();
      const row = page.getByRole('button', { name: new RegExp(title) });
      await expect(row).toContainText('承認待ち');
      await expect(row).toContainText('¥99,000');
      expect(await db.payment_requests.findFirst({ where: { title } })).toMatchObject({ amount: 110000, deduction_amount: 11000, status: 'pending' });
    });

    test('口座未確認の取引先を選ぶと注意が出る', async ({ page }) => {
      const v = await makeVendor({ name: '未確認商事', verified: false });
      await page.goto('/payments');
      await page.getByRole('button', { name: '＋ 振込を申請' }).click();
      await field(page, '振込先').selectOption(v.id);
      await expect(page.getByText('口座が未確認です。管理者が確認するまで承認されません。')).toBeVisible();
    });

    test('控除が請求金額を超えると申請ボタンが押せない', async ({ page }) => {
      const v = await makeVendor();
      await page.goto('/payments');
      await page.getByRole('button', { name: '＋ 振込を申請' }).click();
      await field(page, '振込先').selectOption(v.id);
      await field(page, '件名・内容').fill('控除超過');
      await field(page, '請求金額').fill('1000');
      await field(page, '控除').fill('2000');
      await field(page, '支払期日').fill(jstDate(7));
      await expect(page.getByRole('button', { name: '申請する' })).toBeDisabled();
    });

    test('承認待ちの申請を取り下げできる', async ({ page }) => {
      const v = await makeVendor();
      const p = await makePayment({ role: 'sato', vendorId: v.id, title: '取り下げる申請' });
      await page.goto('/payments');
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: /取り下げる申請/ }).click();
      await page.getByRole('button', { name: '取り下げ', exact: true }).click();
      await expect(page.getByText('取り下げる申請')).toHaveCount(0);
      expect(await db.payment_requests.findUnique({ where: { id: p.id } })).toBeNull();
    });

    test('一般ユーザーには「承認・振込」タブが出ない', async ({ page }) => {
      await page.goto('/payments');
      await expect(page.getByRole('button', { name: '自分の申請' })).toBeVisible();
      await expect(page.getByRole('button', { name: '承認・振込' })).toHaveCount(0);
    });
  });

  test.describe('管理者', () => {
    test.use({ storageState: AUTH.admin });
    test('承認待ちの申請を、口座確認→承認の順に処理できる', async ({ page }) => {
      const v = await makeVendor({ verified: false, name: '確認待ち商事' });
      await makePayment({ role: 'sato', vendorId: v.id, title: '口座確認の流れ' });
      await page.goto('/payments');
      await page.getByRole('button', { name: '承認・振込' }).click();
      await expect(page.getByText('口座確認の流れ')).toBeVisible();
      await expect(page.getByRole('button', { name: '承認', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '口座を確認済にする' }).click();
      await expect(page.getByText('口座を確認済にしました')).toBeVisible();
      await page.getByRole('button', { name: '承認', exact: true }).click();
      await expect(page.getByText('承認しました')).toBeVisible();
      expect((await db.payment_requests.findFirst({ where: { title: '口座確認の流れ' } }))!.status).toBe('approved');
    });
  });

});
