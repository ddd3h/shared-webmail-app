import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { jstDate, resetTransfers } from './helpers/seed';
import { makeClaim, makePayment, makePayslip, makeVendor, verifyBankAccount } from './helpers/factories';
import { field } from './helpers/ui';
import type { APIRequestContext } from '@playwright/test';

const HEADER = {
  client_code: '1234567890', client_name: 'ｶ)ｻﾝﾌﾟﾙ', bank_code: '0001', bank_name: 'ﾐｽﾞﾎ', branch_code: '123', branch_name: 'ﾎﾝﾃﾝ', account_type: 'ordinary', account_number: '7654321',
};
const ACCOUNT = { bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '234', account_type: 'ordinary', account_number: '1234567', account_holder: 'サトウ タロウ' };
const tomorrow = () => jstDate(1);

async function configure(admin: APIRequestContext) {
  const res = await admin.put('/api/zengin/settings', { data: HEADER });
  expect(res.status()).toBe(200);
}
// sato registers an account and finance staff confirm it
async function readyAccount(as: (r: any) => Promise<APIRequestContext>, role: 'sato' | 'tanaka' = 'sato', over: Record<string, string> = {}) {
  const me = await as(role);
  expect((await me.put('/api/bank-accounts/me', { data: { ...ACCOUNT, ...over } })).status()).toBe(200);
  const keiri = await as('keiri');
  expect((await verifyBankAccount(keiri, USERS[role].id)).status()).toBe(200);
}
function lines(buf: Buffer) { return buf.toString('latin1').split('\r\n').filter(Boolean); }

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetTransfers(); });

test.describe('権限', () => {
  test('一般ユーザー・未ログインは全銀データ・口座一覧・設定を見られない', async ({ as, anon }) => {
    const sato = await as('sato');
    for (const url of ['/api/transfers/batches', '/api/bank-accounts', '/api/zengin/settings', `/api/transfers/payroll`]) {
      expect((await sato.get(url)).status(), url).toBe(403);
    }
    expect((await sato.post('/api/transfers/batches', { data: { kind: 'payroll', ids: ['x'], transfer_date: tomorrow() } })).status()).toBe(403);
    expect((await sato.put('/api/zengin/settings', { data: HEADER })).status()).toBe(403);
    for (const url of ['/api/transfers/batches', '/api/bank-accounts']) {
      const r = await anon.get(url, { maxRedirects: 0 });
      expect([307, 401, 403]).toContain(r.status());
    }
  });

  test('経理担当は作成・確認ができるが、全銀の設定の変更は管理者だけ', async ({ as }) => {
    const keiri = await as('keiri');
    expect((await keiri.get('/api/transfers/batches')).status()).toBe(200);
    expect((await keiri.get('/api/bank-accounts')).status()).toBe(200);
    expect((await keiri.put('/api/zengin/settings', { data: HEADER })).status()).toBe(403);
    expect((await (await as('admin')).put('/api/zengin/settings', { data: HEADER })).status()).toBe(200);
  });

  test('経理担当の設定は管理者だけが変えられ、変えると権限がすぐ変わる', async ({ as }) => {
    const admin = await as('admin');
    const sato = await as('sato');
    expect((await sato.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_accounting: true } })).status()).toBe(403);
    const keiri = await as('keiri');
    expect((await keiri.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_accounting: true } })).status()).toBe(403);
    expect((await admin.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_accounting: true } })).status()).toBe(200);
    expect((await (await as('tanaka')).get('/api/bank-accounts')).status()).toBe(200);
    expect((await admin.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_accounting: false } })).status()).toBe(200);
    expect((await (await as('tanaka')).get('/api/bank-accounts')).status()).toBe(403);
    expect(await db.audit_logs.count({ where: { action_type: 'accounting_role_update' } })).toBeGreaterThanOrEqual(2);
  });

  test('経理担当は申請を承認することはできない（承認は管理者だけ）', async ({ as }) => {
    const v = await makeVendor();
    const p = await makePayment({ vendorId: v.id, status: 'pending' });
    const res = await (await as('keiri')).post(`/api/payments/${p.id}/review`, { data: { action: 'approve' } });
    expect(res.status()).toBe(403);
    expect((await db.payment_requests.findUnique({ where: { id: p.id } }))!.status).toBe('pending');
  });
});

test.describe('受取口座', () => {
  test('登録すると本人は番号まで見られ、DBには暗号化して保存される', async ({ as }) => {
    const sato = await as('sato');
    const put = await sato.put('/api/bank-accounts/me', { data: ACCOUNT });
    expect(put.status()).toBe(200);
    const me = await (await sato.get('/api/bank-accounts/me')).json();
    expect(me.account).toMatchObject({ bank_code: '0001', account_number: '1234567', verified: false });
    const row = await db.user_bank_accounts.findUnique({ where: { user_id: USERS.sato.id } });
    expect(row!.account_number_enc).not.toContain('1234567');
    expect(row!.account_last4).toBe('4567');
  });

  test('他の人の口座は一般ユーザーには見えない（経理担当には番号まで見える）', async ({ as }) => {
    await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
    const mine = await (await as('tanaka')).get('/api/bank-accounts/me');
    expect((await mine.json()).account).toBeNull();
    const list = await (await as('keiri')).get('/api/bank-accounts');
    const item = (await list.json()).items.find((i: any) => i.user.id === USERS.sato.id);
    expect(item.account.account_number).toBe('1234567');
  });

  const bad: [string, Record<string, string>][] = [
    ['銀行コードが3桁', { bank_code: '001' }], ['支店コードが4桁', { branch_code: '2345' }], ['口座番号が3桁', { account_number: '123' }],
    ['口座番号が8桁', { account_number: '12345678' }], ['口座番号に文字', { account_number: '12a4567' }], ['口座名義が漢字（全銀で使えない）', { account_holder: '佐藤 太郎' }],
    ['銀行名が空', { bank_name: '' }], ['銀行名が長すぎる', { bank_name: 'あ'.repeat(61) }], ['預金種目が不正', { account_type: 'foo' }], ['口座名義が空', { account_holder: '  ' }],
  ];
  for (const [name, over] of bad) {
    test(`${name}だと保存できない`, async ({ as }) => {
      const res = await (await as('sato')).put('/api/bank-accounts/me', { data: { ...ACCOUNT, ...over } });
      expect(res.status()).toBe(400);
      expect(await db.user_bank_accounts.count()).toBe(0);
    });
  }

  test('内容を変えると確認済が外れ、同じ内容の保存では外れない', async ({ as }) => {
    await readyAccount(as);
    const sato = await as('sato');
    expect((await sato.put('/api/bank-accounts/me', { data: ACCOUNT })).status()).toBe(200);
    expect((await db.user_bank_accounts.findUnique({ where: { user_id: USERS.sato.id } }))!.verified_at).not.toBeNull();
    const res = await sato.put('/api/bank-accounts/me', { data: { ...ACCOUNT, account_number: '7654321' } });
    expect((await res.json()).verification_cleared).toBe(true);
    expect((await db.user_bank_accounts.findUnique({ where: { user_id: USERS.sato.id } }))!.verified_at).toBeNull();
  });

  test('一般ユーザーは自分の口座を確認済にできない', async ({ as }) => {
    const sato = await as('sato');
    await sato.put('/api/bank-accounts/me', { data: ACCOUNT });
    expect((await sato.post(`/api/bank-accounts/${USERS.sato.id}/verify`, { data: { revision: 'x' } })).status()).toBe(403);
  });

  test('経理担当は自分の口座を自分では確認済にできないが、他の人の確認はできる', async ({ as }) => {
    const keiri = await as('keiri');
    await keiri.put('/api/bank-accounts/me', { data: ACCOUNT });
    expect((await verifyBankAccount(keiri, USERS.keiri.id)).status()).toBe(403);
    expect((await verifyBankAccount(await as('admin'), USERS.keiri.id)).status()).toBe(200);
  });

  test('口座のない人の確認は404', async ({ as }) => {
    expect((await (await as('keiri')).post(`/api/bank-accounts/${USERS.tanaka.id}/verify`, { data: { revision: 'x' } })).status()).toBe(404);
  });

  test('登録・変更・確認が監査ログに残る', async ({ as }) => {
    await readyAccount(as);
    const actions = (await db.audit_logs.findMany({ where: { action_type: { in: ['bank_account_change', 'bank_account_verify'] } } })).map(a => a.action_type);
    expect(actions).toEqual(expect.arrayContaining(['bank_account_change', 'bank_account_verify']));
  });
});

test.describe('全銀の設定', () => {
  test('経理担当には値は返らない（設定済みかどうかだけ）', async ({ as }) => {
    await configure(await as('admin'));
    const body = await (await (await as('keiri')).get('/api/zengin/settings')).json();
    expect(body.configured).toBe(true);
    expect(body.settings.client_code).toBeUndefined();
    expect(body.settings.account_number).toBeUndefined();
    const adminBody = await (await (await as('admin')).get('/api/zengin/settings')).json();
    expect(adminBody.settings.client_code).toBe('1234567890');
  });

  test('委託者コード・口座番号は暗号化して保存される', async ({ as }) => {
    await configure(await as('admin'));
    const rows = await db.app_settings.findMany({ where: { key: { in: ['ZENGIN_CLIENT_CODE', 'ZENGIN_ACCOUNT_NUMBER'] } } });
    expect(rows).toHaveLength(2);
    for (const r of rows) { expect(r.is_secret).toBe(true); expect(r.value).not.toContain('1234567890'); }
  });

  const badSettings: [string, Record<string, string>][] = [
    ['委託者コードが9桁', { client_code: '123456789' }], ['委託者名が漢字', { client_name: '株式会社' }], ['銀行コードが5桁', { bank_code: '00012' }],
    ['支店コードが2桁', { branch_code: '12' }], ['口座番号が8桁', { account_number: '12345678' }], ['預金種目が不正', { account_type: 'x' }],
  ];
  for (const [name, over] of badSettings) {
    test(`${name}だと保存できない`, async ({ as }) => {
      expect((await (await as('admin')).put('/api/zengin/settings', { data: { ...HEADER, ...over } })).status()).toBe(400);
    });
  }

  test('未設定のままでは全銀データを作れない', async ({ as }) => {
    await readyAccount(as);
    const slip = await makePayslip({});
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toBe('zengin_settings');
  });
});

test.describe('給与の全銀データ', () => {
  test('確認済の口座の明細から、全銀形式の正しいファイルが作れる', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    await readyAccount(as, 'tanaka', { account_number: '7000001', account_holder: 'タナカ ハナコ' });
    const a = await makePayslip({ role: 'sato', items: [{ kind: 'earning', label: '基本給', amount: 300000 }, { kind: 'deduction', label: '社会保険', amount: 45000 }] });
    const b = await makePayslip({ role: 'tanaka', items: [{ kind: 'earning', label: '基本給', amount: 250000 }] });
    const keiri = await as('keiri');
    const res = await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [a.id, b.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(201);
    const made = await res.json();
    expect(made).toMatchObject({ count: 2, total: 505000 });

    const dl = await keiri.get(`/api/transfers/batches/${made.id}/download`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()['content-disposition']).toContain('attachment');
    const buf = await dl.body();
    expect(buf.length % 122).toBe(0); // 120 bytes + CRLF per record
    const rec = lines(buf);
    expect(rec).toHaveLength(5); // header, 2 data, trailer, end
    for (const r of rec) expect(r.length).toBe(120);
    expect(rec[0].startsWith('111')).toBe(true); // 1 = header, 11 = 給与振込
    expect(rec[0].slice(3, 4)).toBe('0'); // 0 = JIS
    expect(rec[0].slice(4, 14)).toBe('1234567890');
    expect(rec[0].slice(54, 58)).toBe(tomorrow().slice(5).replace('-', ''));
    expect(rec[1][0]).toBe('2');
    expect(rec[1].slice(1, 5)).toBe('0001');
    expect(rec[1].slice(20, 23)).toBe('234');
    expect(rec[1].slice(43, 50)).toBe('1234567');
    expect(rec[1].slice(80, 90)).toBe('0000255000');
    expect(rec[2].slice(80, 90)).toBe('0000250000');
    expect(rec[3][0]).toBe('8');
    expect(rec[3].slice(1, 7)).toBe('000002');
    expect(rec[3].slice(7, 19)).toBe('000000505000');
    expect(rec[4][0]).toBe('9');
    // single byte only: nothing above 0xFF (half-width kana are 0xA1-0xDF in the single-byte set)
    expect([...buf].every(c => c < 256)).toBe(true);
  });

  test('賞与振込（種別12）にもできる', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({ title: '賞与' });
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], category: '12', transfer_date: tomorrow() } });
    expect(res.status()).toBe(201);
    const b = await db.transfer_batches.findFirst();
    expect(b!.category_code).toBe('12');
  });

  test('口座が未登録・未確認の人が混ざると、問題を全部示して1件も作らない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    await (await as('tanaka')).put('/api/bank-accounts/me', { data: ACCOUNT }); // registered but not verified
    const ok = await makePayslip({ role: 'sato' });
    const unverified = await makePayslip({ role: 'tanaka' });
    const none = await makePayslip({ role: 'suzuki' });
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [ok.id, unverified.id, none.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.problems.map((p: any) => p.id).sort()).toEqual([unverified.id, none.id].sort());
    expect(body.problems.find((p: any) => p.id === none.id).reason).toContain('登録されていません');
    expect(body.problems.find((p: any) => p.id === unverified.id).reason).toContain('未確認');
    expect(await db.transfer_batches.count()).toBe(0);
    expect((await db.payslips.findUnique({ where: { id: ok.id } }))!.batch_id).toBeNull();
  });

  test('支払済の明細・存在しない明細は含められない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const paid = await makePayslip({ status: 'paid', month: '2026-01' });
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [paid.id, 'nope'], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
    expect((await res.json()).problems).toHaveLength(2);
  });

  test('同じ明細を2回作ると二重振込として止まり、「作成済みも含める」で作り直せる', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const keiri = await as('keiri');
    const data = { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() };
    expect((await keiri.post('/api/transfers/batches', { data })).status()).toBe(201);
    const again = await keiri.post('/api/transfers/batches', { data });
    expect(again.status()).toBe(422);
    expect((await again.json()).problems[0].reason).toContain('二重振込');
    expect((await keiri.post('/api/transfers/batches', { data: { ...data, force: true } })).status()).toBe(201);
    expect(await db.transfer_batches.count()).toBe(2);
  });

  test('同じIDを重複して送っても1件として扱う', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id, slip.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(201);
    expect((await res.json()).count).toBe(1);
  });

  test('振込指定日が過去・不正・遠すぎる場合は作れない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const keiri = await as('keiri');
    for (const d of [jstDate(-1), '2026-02-30', 'abc', jstDate(90), '']) {
      const res = await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: d } });
      expect(res.status(), d).toBe(400);
    }
    expect((await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: jstDate(0) } })).status()).toBe(201);
  });

  test('明細IDが空・種別が不正なら400', async ({ as }) => {
    const keiri = await as('keiri');
    expect((await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [], transfer_date: tomorrow() } })).status()).toBe(400);
    expect((await keiri.post('/api/transfers/batches', { data: { kind: 'other', ids: ['a'], transfer_date: tomorrow() } })).status()).toBe(400);
  });

  test('支給額が0円の明細は含められない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const zero = await makePayslip({ items: [{ kind: 'earning', label: '基本給', amount: 10000 }, { kind: 'deduction', label: '控除', amount: 10000 }] });
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [zero.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
  });

  test('月ごとの一覧には口座の状態が付き、口座番号は含まれない', async ({ as }) => {
    await readyAccount(as);
    await makePayslip({ role: 'sato' });
    await makePayslip({ role: 'tanaka' });
    const res = await (await as('keiri')).get('/api/transfers/payroll');
    const body = await res.json();
    const sato = body.items.find((i: any) => i.user.id === USERS.sato.id);
    const tanaka = body.items.find((i: any) => i.user.id === USERS.tanaka.id);
    expect(sato.account).toMatchObject({ registered: true, verified: true, last4: '4567' });
    expect(tanaka.account).toMatchObject({ registered: false });
    expect(JSON.stringify(body)).not.toContain('1234567');
  });
});

test.describe('支払い済みの記録・取り消し', () => {
  test('一括で支払済にすると明細が支払済になり、合算した経費の立替金も精算される', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({ items: [{ kind: 'earning', label: '基本給', amount: 300000 }] });
    const claim = await makeClaim({ role: 'sato', status: 'approved', amount: 4800, payslipId: slip.id });
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    const res = await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} });
    expect(res.status()).toBe(200);
    expect((await res.json()).paid).toBe(1);
    expect((await db.payslips.findUnique({ where: { id: slip.id } }))!.status).toBe('paid');
    expect((await db.expense_claims.findUnique({ where: { id: claim.id } }))!.status).toBe('paid');
    expect((await db.transfer_batches.findUnique({ where: { id: made.id } }))!.paid_at).not.toBeNull();
  });

  test('2回目の記録は409で、二重に処理されない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    const [a, b] = await Promise.all([keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} }), keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} })]);
    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
  });

  test('支払済になった明細は新しい全銀データに含められない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} });
    const again = await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow(), force: true } });
    expect(again.status()).toBe(422);
  });

  test('未送付のデータは取り消せて、明細は再び選べる。支払済は取り消せない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    expect((await keiri.delete(`/api/transfers/batches/${made.id}`)).status()).toBe(200);
    expect((await db.payslips.findUnique({ where: { id: slip.id } }))!.batch_id).toBeNull();
    const again = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    await keiri.post(`/api/transfers/batches/${again.id}/mark-paid`, { data: {} });
    expect((await keiri.delete(`/api/transfers/batches/${again.id}`)).status()).toBe(409);
    expect((await keiri.delete(`/api/transfers/batches/none`)).status()).toBe(404);
  });

  test('一般ユーザーは記録も取り消しもダウンロードもできない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const made = await (await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    const sato = await as('sato');
    expect((await sato.get(`/api/transfers/batches/${made.id}/download`)).status()).toBe(403);
    expect((await sato.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} })).status()).toBe(403);
    expect((await sato.delete(`/api/transfers/batches/${made.id}`)).status()).toBe(403);
  });

  test('作成・ダウンロード・支払済の記録が監査ログに残る', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    await keiri.get(`/api/transfers/batches/${made.id}/download`);
    await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} });
    const actions = (await db.audit_logs.findMany({ where: { target_id: made.id } })).map(a => a.action_type);
    expect(actions).toEqual(expect.arrayContaining(['transfer_batch_create', 'transfer_batch_download', 'transfer_batch_paid']));
  });
});

test.describe('整合性・安全策', () => {
  const month = () => jstDate(0).slice(0, 7);

  test('口座を見てから確認するまでの間に本人が変更したら、確認は失敗する（差し替え対策）', async ({ as }) => {
    const sato = await as('sato');
    await sato.put('/api/bank-accounts/me', { data: ACCOUNT });
    const keiri = await as('keiri');
    const seen = (await (await keiri.get('/api/bank-accounts')).json()).items.find((i: any) => i.user.id === USERS.sato.id).account.revision;
    await sato.put('/api/bank-accounts/me', { data: { ...ACCOUNT, account_number: '7654321' } }); // swapped after finance looked
    const res = await keiri.post(`/api/bank-accounts/${USERS.sato.id}/verify`, { data: { revision: seen } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe('changed');
    expect((await db.user_bank_accounts.findUnique({ where: { user_id: USERS.sato.id } }))!.verified_at).toBeNull();
    expect((await verifyBankAccount(keiri, USERS.sato.id)).status()).toBe(200); // looking again works
  });

  test('確認に revision がない・壊れていると400/409で、確認済にならない', async ({ as }) => {
    await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
    const keiri = await as('keiri');
    expect((await keiri.post(`/api/bank-accounts/${USERS.sato.id}/verify`, { data: {} })).status()).toBe(400);
    expect((await keiri.post(`/api/bank-accounts/${USERS.sato.id}/verify`, { data: { revision: 'not-a-date' } })).status()).toBe(409);
    expect((await db.user_bank_accounts.findUnique({ where: { user_id: USERS.sato.id } }))!.verified_at).toBeNull();
  });

  test('口座一覧（口座番号つき）を開いたことが監査ログに残る', async ({ as }) => {
    const before = await db.audit_logs.count({ where: { action_type: 'bank_account_list_view' } });
    await (await as('keiri')).get('/api/bank-accounts');
    expect(await db.audit_logs.count({ where: { action_type: 'bank_account_list_view' } })).toBe(before + 1);
  });

  async function batchedSlip(as: any) {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({ role: 'sato', month: month() });
    const made = await (await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    return { slip, batchId: made.id as string };
  }
  const putBody = (slip: { title: string }, over: object = {}) => ({ pay_month: month(), title: slip.title, status: 'planned', items: [{ kind: 'earning', label: '基本給', amount: 999999 }], ...over });

  test('全銀データに入った明細は、金額の変更・支払済への変更・削除ができない（ファイルとずれるため）', async ({ as }) => {
    const { slip } = await batchedSlip(as);
    const admin = await as('admin');
    for (const over of [{}, { status: 'paid' }]) {
      const res = await admin.put(`/api/work/payslips/${slip.id}`, { data: putBody(slip, over) });
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toBe('in_transfer_batch');
    }
    expect((await admin.delete(`/api/work/payslips/${slip.id}`)).status()).toBe(409);
    expect((await db.payslips.findUnique({ where: { id: slip.id }, include: { items: true } }))!.items[0].amount).toBe(300000);
  });

  test('データを取り消すと、その明細は再び編集できる', async ({ as }) => {
    const { slip, batchId } = await batchedSlip(as);
    await (await as('keiri')).delete(`/api/transfers/batches/${batchId}`);
    expect((await (await as('admin')).put(`/api/work/payslips/${slip.id}`, { data: putBody(slip) })).status()).toBe(200);
  });

  test('振込済になった後の明細は、これまで通り編集できる', async ({ as }) => {
    const { slip, batchId } = await batchedSlip(as);
    await (await as('keiri')).post(`/api/transfers/batches/${batchId}/mark-paid`, { data: {} });
    expect((await (await as('admin')).put(`/api/work/payslips/${slip.id}`, { data: putBody(slip, { status: 'paid', pay_date: jstDate(0) }) })).status()).toBe(200);
  });

  test('全銀データに入った明細には、後から承認した立替金が合算されない（別の「立替金精算」明細ができる）', async ({ as }) => {
    const { slip } = await batchedSlip(as);
    const claim = await makeClaim({ role: 'sato', status: 'approved', amount: 4800 });
    const res = await (await as('admin')).post('/api/expenses/reimburse', { data: { ids: [claim.id], mode: 'payslip', pay_month: month() } });
    expect(res.status()).toBe(200);
    const moved = await db.expense_claims.findUnique({ where: { id: claim.id } });
    expect(moved!.payslip_id).not.toBe(slip.id);
    expect((await db.payslips.findUnique({ where: { id: slip.id }, include: { items: true } }))!.items.map(i => i.amount)).toEqual([300000]);
  });

  test('全銀データに入った明細から、経費を外すこともできない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({ role: 'sato', month: month() });
    const claim = await makeClaim({ role: 'sato', status: 'approved', amount: 4800, payslipId: slip.id });
    await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } });
    const res = await (await as('admin')).post('/api/expenses/unlink', { data: { ids: [claim.id] } });
    expect((await res.json()).detached).toBe(0);
    expect((await db.expense_claims.findUnique({ where: { id: claim.id } }))!.payslip_id).toBe(slip.id);
  });

  test('同時に同じ明細で全銀データを作っても、1つだけ作られる', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const data = { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() };
    const [a, b] = await Promise.all([(await as('keiri')).post('/api/transfers/batches', { data }), (await as('admin')).post('/api/transfers/batches', { data })]);
    expect([a.status(), b.status()].filter(c => c === 201)).toHaveLength(1);
    expect(await db.transfer_batches.count()).toBe(1);
  });

  test('ファイルは作成時の内容のまま。作成後に口座を変更しても、ダウンロードの中身は変わらない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } })).json();
    const first = await (await keiri.get(`/api/transfers/batches/${made.id}/download`)).body();
    await (await as('sato')).put('/api/bank-accounts/me', { data: { ...ACCOUNT, account_number: '7654321' } });
    expect(Buffer.compare(first, await (await keiri.get(`/api/transfers/batches/${made.id}/download`)).body())).toBe(0);
  });

  test('口座が変更された（確認済が外れた）明細は、新しいデータに含められない', async ({ as }) => {
    await configure(await as('admin'));
    await readyAccount(as);
    const slip = await makePayslip({});
    await (await as('sato')).put('/api/bank-accounts/me', { data: { ...ACCOUNT, account_number: '7654321' } });
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
    expect((await res.json()).problems[0].reason).toContain('未確認');
  });
});

test.describe('支払（取引先）の全銀データ', () => {
  test('承認済・口座確認済の振込申請から総合振込（種別21）のファイルが作れ、記録すると振込済になる', async ({ as }) => {
    await configure(await as('admin'));
    const v = await makeVendor({ accountNumber: '3141592' });
    const p = await makePayment({ vendorId: v.id, status: 'approved', amount: 110000, deduction: 11000, fee: 330, bearer: 'vendor' });
    const keiri = await as('keiri');
    const res = await keiri.post('/api/transfers/batches', { data: { kind: 'payment', ids: [p.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(201);
    const made = await res.json();
    expect(made.total).toBe(98670);
    const rec = lines(await (await keiri.get(`/api/transfers/batches/${made.id}/download`)).body());
    expect(rec[0].startsWith('121')).toBe(true);
    expect(rec[1].slice(43, 50)).toBe('3141592');
    expect(rec[1].slice(80, 90)).toBe('0000098670');
    expect((await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} })).status()).toBe(200);
    expect((await db.payment_requests.findUnique({ where: { id: p.id } }))!.status).toBe('paid');
  });

  test('口座未確認・未承認の申請は含められない', async ({ as }) => {
    await configure(await as('admin'));
    const unverified = await makeVendor({ verified: false });
    const ok = await makeVendor();
    const a = await makePayment({ vendorId: unverified.id, status: 'approved' });
    const b = await makePayment({ vendorId: ok.id, status: 'pending' });
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payment', ids: [a.id, b.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
    expect((await res.json()).problems).toHaveLength(2);
  });

  test('取引先の口座名義が全銀で使えない文字だとその件が問題として示される', async ({ as }) => {
    await configure(await as('admin'));
    const v = await makeVendor();
    await db.payment_vendors.update({ where: { id: v.id }, data: { account_holder: '株式会社テスト' } });
    const p = await makePayment({ vendorId: v.id, status: 'approved' });
    const res = await (await as('keiri')).post('/api/transfers/batches', { data: { kind: 'payment', ids: [p.id], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
    expect((await res.json()).problems[0].id).toBe(p.id);
  });

  test('経理担当は取引先の口座番号を見られる（一般ユーザーは末尾のみ）', async ({ as }) => {
    const v = await makeVendor({ accountNumber: '9988776' });
    const keiri = await (await as('keiri')).get('/api/payments/vendors');
    expect(JSON.stringify(await keiri.json())).toContain('9988776');
    const sato = await (await as('sato')).get('/api/payments/vendors');
    const text = JSON.stringify(await sato.json());
    expect(text).not.toContain('9988776');
    expect(text).toContain(v.id);
  });
});

test.describe('画面', () => {
  test.describe('一般ユーザー', () => {
    test.use({ storageState: AUTH.sato });
    test('/transfers を開いても利用できない旨が出て、メニューにも出ない', async ({ page }) => {
      await page.goto('/transfers');
      await expect(page.getByText('経理担当と管理者だけが使えます')).toBeVisible();
      await expect(page.locator('header nav').getByRole('link', { name: '振込データ' })).toHaveCount(0);
    });

    test('勤怠・給与の「受取口座」から口座を登録でき、カナ以外はエラーになる', async ({ page }) => {
      await page.goto('/work');
      await page.getByRole('button', { name: '受取口座', exact: true }).click();
      await page.getByPlaceholder('みずほ銀行').fill('みずほ銀行');
      await page.getByPlaceholder('0001').fill('0001');
      await page.getByPlaceholder('新宿支店').fill('新宿支店');
      await page.getByPlaceholder('123', { exact: true }).fill('234');
      await page.getByPlaceholder('1234567').fill('1234567');
      await page.getByPlaceholder('ヤマダ タロウ').fill('佐藤 太郎');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByText('口座名義は、全銀の振込データに使えるカナ')).toBeVisible();
      await page.getByPlaceholder('ヤマダ タロウ').fill('サトウ タロウ');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByText('保存しました')).toBeVisible();
      await expect(page.getByText('確認待ち')).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: '受取口座', exact: true }).click();
      await expect(page.getByPlaceholder('1234567')).toHaveValue('1234567');
    });
  });

  test.describe('経理担当', () => {
    test.use({ storageState: AUTH.keiri });

    test('受取口座を確認済にし、給与の全銀データを作って、ダウンロードして、振込済にできる', async ({ page, as }) => {
      await configure(await as('admin'));
      await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
      const slip = await makePayslip({ role: 'sato', title: '10月分給与' });

      await page.goto('/transfers');
      await page.getByRole('button', { name: '受取口座の確認' }).click();
      await expect(page.getByText('サトウ タロウ')).toBeVisible();
      await page.getByRole('button', { name: '確認済にする' }).click();
      await expect(page.getByText('確認済にしました')).toBeVisible();

      await page.getByRole('button', { name: '給与の振込' }).click();
      await page.getByLabel(/佐藤 10月分給与/).check();
      await page.getByRole('button', { name: '全銀データを作成…' }).click();
      await page.getByRole('button', { name: '作成する' }).click();
      await expect(page.getByText('全銀データを作成しました')).toBeVisible();

      await page.getByRole('button', { name: '作成履歴' }).click();
      await expect(page.getByText('給与 1件')).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'ダウンロード' }).click()]);
      expect(download.suggestedFilename()).toMatch(/^zengin-payroll-.*\.txt$/);

      await page.getByRole('button', { name: '振込済にする' }).click();
      await page.getByRole('button', { name: '記録する' }).click();
      await expect(page.getByText('1件を支払済にしました')).toBeVisible();
      expect((await db.payslips.findUnique({ where: { id: slip.id } }))!.status).toBe('paid');
    });

    test('口座未確認の人は選択できず「受取口座が未確認」と出る', async ({ page, as }) => {
      await configure(await as('admin'));
      await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
      await makePayslip({ role: 'sato' });
      await makePayslip({ role: 'tanaka' });
      await page.goto('/transfers');
      await expect(page.getByText('受取口座が未確認')).toBeVisible();
      await expect(page.getByText('受取口座が未登録')).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /佐藤/ })).toBeDisabled();
      await expect(page.getByRole('button', { name: '全銀データを作成…' })).toBeDisabled();
    });

    test('設定が未完了だと作成時にエラーが表示される。経理担当は設定を編集できない', async ({ page, as }) => {
      await readyAccount(as);
      await makePayslip({ role: 'sato' });
      await page.goto('/transfers');
      await page.getByLabel(/佐藤/).check();
      await page.getByRole('button', { name: '全銀データを作成…' }).click();
      await page.getByRole('button', { name: '作成する' }).click();
      await expect(page.getByText('全銀の設定（委託者情報）を確認してください')).toBeVisible();
      await page.getByRole('button', { name: '閉じる' }).click();
      await page.getByRole('button', { name: '全銀の設定' }).click();
      await expect(page.getByText('管理者に設定を依頼してください')).toBeVisible();
    });

    test('メニューに「振込データ」が出る', async ({ page }) => {
      await page.goto('/threads');
      await page.locator('header nav').getByRole('link', { name: '振込データ', exact: true }).click();
      await expect(page).toHaveURL(/\/transfers/);
      await expect(page.getByRole('heading', { level: 1, name: '振込データ' })).toBeVisible();
    });
  });

  test.describe('管理者', () => {
    test.use({ storageState: AUTH.admin });

    test('全銀の設定を画面から保存でき、入力が不正だとエラーになる', async ({ page }) => {
      await page.goto('/transfers');
      await page.getByRole('button', { name: '全銀の設定' }).click();
      await expect(page.getByText('未設定')).toBeVisible();
      await field(page, '委託者コード').fill('123');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByText('入力を確認してください')).toBeVisible();

      await field(page, '委託者コード').fill(HEADER.client_code);
      await field(page, '委託者名').fill('カ）サンプル');
      await field(page, '取引銀行名').fill('みずほ銀行');
      await field(page, '銀行コード').fill('0001');
      await field(page, '支店名').fill('本店');
      await field(page, '支店コード').fill('123');
      await field(page, '口座番号').fill('7654321');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByText('保存しました')).toBeVisible();
      await expect(page.getByText('設定済み')).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: '全銀の設定' }).click();
      await expect(field(page, '委託者コード')).toHaveValue(HEADER.client_code);
    });

    test('勤怠・給与の管理で経理担当を設定できる', async ({ page }) => {
      await page.goto('/work');
      await page.getByRole('button', { name: '管理', exact: true }).click();
      await page.getByLabel('田中を経理担当にする').click(); // the box flips once the server has answered, so click() rather than check()
      await expect(page.getByText('経理担当にしました')).toBeVisible();
      expect((await db.users.findUnique({ where: { id: USERS.tanaka.id } }))!.is_accounting).toBe(true);
      await expect(page.getByLabel('田中を経理担当にする')).toBeChecked();
      await page.getByLabel('田中を経理担当にする').click();
      await expect(page.getByText('経理担当を外しました')).toBeVisible();
      await db.users.update({ where: { id: USERS.tanaka.id }, data: { is_accounting: false } });
    });
  });
});
