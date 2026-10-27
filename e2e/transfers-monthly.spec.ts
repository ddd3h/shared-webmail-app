import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH, USERS, type Role } from './helpers/constants';
import { db } from './helpers/db';
import { jstDate, resetTransfers } from './helpers/seed';
import { makeClaim, makePayment, makePayslip, makeVendor, verifyBankAccount } from './helpers/factories';

test.describe.configure({ mode: 'serial' });

const HEADER = { client_code: '1234567890', client_name: 'ｶ)ｻﾝﾌﾟﾙ', bank_code: '0001', bank_name: 'ﾐｽﾞﾎ', branch_code: '123', branch_name: 'ﾎﾝﾃﾝ', account_type: 'ordinary', account_number: '7654321' };
const kana: Record<string, string> = { sato: 'サトウ タロウ', tanaka: 'タナカ ハナコ', suzuki: 'スズキ サブロウ', yamada: 'ヤマダ イチロウ' };
const tomorrow = () => jstDate(1);
// expenses are paid back on the 振込日 of the person's kind of worker (default: the 25th of the next month), so the month under test is the next one
const month = () => { const d = new Date(Date.now() + 9 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); };
const today = () => jstDate(0);
const records = (buf: Buffer) => buf.toString('latin1').split('\r\n').filter(Boolean);

test.beforeEach(async () => {
  await resetTransfers();
  await db.pay_schedules.deleteMany({});
  for (const [id, t] of [[USERS.sato.id, 'employee'], [USERS.tanaka.id, 'employee'], [USERS.suzuki.id, 'contractor'], [USERS.yamada.id, 'executive']] as const) await db.users.update({ where: { id }, data: { worker_type: t } });
});
test.afterAll(async () => { await resetTransfers(); });

async function configure(as: (r: Role) => Promise<APIRequestContext>) {
  expect((await (await as('admin')).put('/api/zengin/settings', { data: HEADER })).status()).toBe(200);
}
async function readyAccount(as: (r: Role) => Promise<APIRequestContext>, role: 'sato' | 'tanaka' | 'suzuki' | 'yamada', number: string) {
  expect((await (await as(role)).put('/api/bank-accounts/me', { data: { bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '234', account_type: 'ordinary', account_number: number, account_holder: kana[role] } })).status()).toBe(200);
  expect((await verifyBankAccount(await as('keiri'), USERS[role].id)).status()).toBe(200);
}

/** One of everything: 給与, 業務委託費, 役員報酬, 振込申請 and two expense claims of one person (a person with an account on file for each). */
async function setUpMonth(as: (r: Role) => Promise<APIRequestContext>) {
  await configure(as);
  await readyAccount(as, 'sato', '1000001'); await readyAccount(as, 'suzuki', '1000002'); await readyAccount(as, 'yamada', '1000003'); await readyAccount(as, 'tanaka', '1000004');
  const salary = await makePayslip({ role: 'sato', payDate: today(), items: [{ kind: 'earning', label: '基本給', amount: 300000 }, { kind: 'deduction', label: '社保', amount: 45000 }] });
  const fee = await makePayslip({ role: 'suzuki', title: '報酬', payDate: today(), items: [{ kind: 'earning', label: '業務委託費', amount: 200000 }] });
  const exec = await makePayslip({ role: 'yamada', title: '報酬', payDate: today(), items: [{ kind: 'earning', label: '役員報酬', amount: 500000 }] });
  const vendor = await makeVendor({ verified: true });
  const payment = await makePayment({ vendorId: vendor.id, status: 'approved', amount: 110000, due: today() });
  const c1 = await makeClaim({ role: 'tanaka', status: 'approved', amount: 1200 });
  const c2 = await makeClaim({ role: 'tanaka', status: 'approved', amount: 800 });
  return { salary, fee, exec, payment, c1, c2 };
}
const everything = (s: Awaited<ReturnType<typeof setUpMonth>>) => [
  { type: 'payslip', ids: [s.salary.id, s.fee.id, s.exec.id] }, { type: 'payment', ids: [s.payment.id] }, { type: 'expense', ids: [s.c1.id, s.c2.id] },
];

test.describe('月次の一覧（API）', () => {
  test('経理担当・管理者だけが見られる。月の形式が違えば400', async ({ as }) => {
    expect((await (await as('sato')).get(`/api/transfers/monthly?month=${month()}`)).status()).toBe(403);
    expect((await (await as('keiri')).get('/api/transfers/monthly?month=2026-13')).status()).toBe(400);
    expect((await (await as('keiri')).get(`/api/transfers/monthly?month=${month()}`)).status()).toBe(200);
  });

  test('給与・業務委託費・役員報酬・振込申請・経費の立替金が、1つの一覧に出る（経費は人ごとに1行）', async ({ as }) => {
    await setUpMonth(as);
    const d = await (await (await as('keiri')).get(`/api/transfers/monthly?month=${month()}`)).json();
    const by = (l: string) => d.items.filter((i: { kind_label: string }) => i.kind_label === l);
    expect(by('給与')).toHaveLength(1);
    expect(by('業務委託費')).toHaveLength(1);
    expect(by('役員報酬')).toHaveLength(1);
    expect(by('振込申請')).toHaveLength(1);
    expect(by('経費')).toHaveLength(1);
    expect(by('経費')[0]).toMatchObject({ type: 'expense', who: '田中', amount: 2000, group: 'expense', blocker: null });
    expect(by('経費')[0].ids).toHaveLength(2);
    expect(by('給与')[0]).toMatchObject({ amount: 255000, group: 'payroll', blocker: null, batched: false });
    expect(d.totals).toEqual({ payroll: 955000, payment: 110000, expense: 2000, all: 1067000 });
  });

  test('その月の終わりより先のもの・支払済み・却下・合算済みは出ない。期日が過ぎた未払いは「超過」で出る', async ({ as }) => {
    await setUpMonth(as);
    const v = await makeVendor({ verified: true });
    await makePayment({ vendorId: v.id, status: 'approved', due: jstDate(70), title: 'ずっと先' });
    await makePayment({ vendorId: v.id, status: 'paid', due: today(), title: '払済' });
    await makePayment({ vendorId: v.id, status: 'pending', due: today(), title: '承認待ち' });
    await makePayslip({ role: 'sato', status: 'paid', payDate: today(), title: '払済給与' });
    await makeClaim({ role: 'sato', status: 'pending' });
    await makeClaim({ role: 'sato', status: 'approved', method: 'company' });
    const slip = await makePayslip({ role: 'tanaka', payDate: today(), title: '立替金精算' });
    await makeClaim({ role: 'tanaka', status: 'approved', payslipId: slip.id });
    await makePayment({ vendorId: v.id, status: 'approved', due: jstDate(-3), title: '期日超過' });
    const d = await (await (await as('keiri')).get(`/api/transfers/monthly?month=${month()}`)).json();
    const titles = d.items.map((i: { title: string }) => i.title).join('|');
    for (const gone of ['ずっと先', '払済', '承認待ち', '払済給与']) expect(titles).not.toContain(gone);
    expect(d.items.find((i: { title: string }) => i.title === '期日超過').overdue).toBe(true);
    // only tanaka's two claims from the set-up are payable: sato's others are waiting / company-paid, and the merged claim goes with its statement
    const exp = d.items.filter((i: { type: string }) => i.type === 'expense');
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ who: '田中', amount: 2000 });
    expect(d.items.find((i: { title: string }) => i.title.includes('立替金精算'))).toBeTruthy();
  });

  test('口座が未登録・未確認の人には「対応が必要」の印が付く', async ({ as }) => {
    await configure(as);
    await readyAccount(as, 'sato', '1000001');
    await as('tanaka').then(c => c.put('/api/bank-accounts/me', { data: { bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '234', account_type: 'ordinary', account_number: '1000004', account_holder: 'タナカ ハナコ' } }));
    await makePayslip({ role: 'sato', payDate: today() });
    await makePayslip({ role: 'tanaka', payDate: today() });
    await makePayslip({ role: 'suzuki', payDate: today() });
    const d = await (await (await as('keiri')).get(`/api/transfers/monthly?month=${month()}`)).json();
    const blocker = (who: string) => d.items.find((i: { who: string }) => i.who === who).blocker;
    expect([blocker('佐藤'), blocker('田中'), blocker('鈴木')]).toEqual([null, '受取口座が未確認', '受取口座が未登録']);
  });
});

test.describe('月次の全銀データ（API）', () => {
  test('全部を1つの総合振込ファイルにまとめる。経費は人ごとに1行', async ({ as }) => {
    const s = await setUpMonth(as);
    const keiri = await as('keiri');
    const res = await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s), transfer_date: tomorrow() } });
    expect(res.status()).toBe(201);
    const made = await res.json();
    expect(made).toMatchObject({ count: 5, total: 255000 + 200000 + 500000 + 110000 + 2000 });
    const buf = await (await keiri.get(`/api/transfers/batches/${made.id}/download`)).body();
    expect(buf.length % 122).toBe(0);
    const rec = records(buf);
    expect(rec).toHaveLength(8); // header + 5 + trailer + end
    expect(rec[0].slice(0, 3)).toBe('121');                // 種別コード 21 = 総合振込
    for (const r of rec) expect(r.length).toBe(120);
    const batch = await db.transfer_batches.findUnique({ where: { id: made.id } });
    expect(batch).toMatchObject({ kind: 'monthly', category_code: '21', item_count: 5 });
    expect(await db.payslips.count({ where: { batch_id: made.id } })).toBe(3);
    expect(await db.payment_requests.count({ where: { batch_id: made.id } })).toBe(1);
    expect(await db.expense_claims.count({ where: { batch_id: made.id } })).toBe(2);
    const audit = await db.audit_logs.findFirst({ where: { action_type: 'transfer_batch_create' } });
    expect(JSON.parse(audit!.metadata_json).kind).toBe('monthly');
    // the list now shows them as already in a file
    const d = await (await keiri.get(`/api/transfers/monthly?month=${month()}`)).json();
    expect(d.items.every((i: { batched: boolean }) => i.batched)).toBe(true);
  });

  test('振込済にすると、全部が一度に精算される（明細は支払済、申請は振込済、経費は返金済）', async ({ as }) => {
    const s = await setUpMonth(as);
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s), transfer_date: tomorrow() } })).json();
    const res = await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: { paid_date: today() } });
    expect(res.status()).toBe(200);
    expect((await res.json()).paid).toBe(6);   // 3 statements + 1 payment + 2 claims
    expect((await db.payslips.findMany({ where: { batch_id: made.id } })).every(p => p.status === 'paid')).toBe(true);
    expect(await db.payment_requests.findUnique({ where: { id: s.payment.id } })).toMatchObject({ status: 'paid' });
    for (const id of [s.c1.id, s.c2.id]) expect(await db.expense_claims.findUnique({ where: { id } })).toMatchObject({ status: 'paid', reimbursed_by_id: USERS.keiri.id });
    expect((await db.expense_claims.findUnique({ where: { id: s.c1.id } }))!.reimburse_note).toContain('全銀データ');
    expect((await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} })).status()).toBe(409);
    const d = await (await keiri.get(`/api/transfers/monthly?month=${month()}`)).json();
    expect(d.items).toHaveLength(0);
  });

  test('給与明細に合算済みの立替金は、明細の金額に含まれて振り込まれ、振込済で一緒に返金済になる', async ({ as }) => {
    await configure(as); await readyAccount(as, 'sato', '1000001');
    const slip = await makePayslip({ role: 'sato', payDate: today(), items: [{ kind: 'earning', label: '基本給', amount: 100000 }] });
    const claim = await makeClaim({ role: 'sato', status: 'approved', amount: 3000, payslipId: slip.id });
    await db.payslip_items.create({ data: { payslip_id: slip.id, kind: 'earning', label: '立替金精算（1件）', amount: 3000, system_key: 'expense_reimbursement', sort: 1000 } });
    const keiri = await as('keiri');
    const d = await (await keiri.get(`/api/transfers/monthly?month=${month()}`)).json();
    expect(d.items).toHaveLength(1);                        // not listed twice
    expect(d.items[0].amount).toBe(103000);
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: [{ type: 'payslip', ids: [slip.id] }], transfer_date: tomorrow() } })).json();
    expect(made.total).toBe(103000);
    await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: { paid_date: today() } });
    expect((await db.expense_claims.findUnique({ where: { id: claim.id } }))!.status).toBe('paid');
  });

  test('1件でも口座が未確認なら、何も作らず問題を全部返す。作成済みは二重に入れられない', async ({ as }) => {
    const s = await setUpMonth(as);
    await db.user_bank_accounts.updateMany({ where: { user_id: USERS.tanaka.id }, data: { verified_at: null } });
    const keiri = await as('keiri');
    const bad = await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s), transfer_date: tomorrow() } });
    expect(bad.status()).toBe(422);
    const body = await bad.json();
    expect(body.problems).toHaveLength(1);
    expect(body.problems[0].label).toContain('田中');
    expect(await db.transfer_batches.count()).toBe(0);
    expect(await db.payslips.count({ where: { batch_id: { not: null } } })).toBe(0);

    const ok = await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s).slice(0, 2), transfer_date: tomorrow() } });
    expect(ok.status()).toBe(201);
    const again = await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s).slice(0, 1), transfer_date: tomorrow() } });
    expect(again.status()).toBe(422);
    expect(JSON.stringify((await again.json()).problems)).toContain('二重振込');
    expect((await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s).slice(0, 1), transfer_date: tomorrow(), force: true } })).status()).toBe(201);
  });

  test('中身が空・知らないIDは作れない。一般ユーザーは作れない', async ({ as }) => {
    await configure(as);
    const keiri = await as('keiri');
    for (const data of [{ kind: 'monthly', transfer_date: tomorrow() }, { kind: 'monthly', items: [], transfer_date: tomorrow() }]) expect((await keiri.post('/api/transfers/batches', { data })).status()).toBe(400);
    const res = await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: [{ type: 'expense', ids: ['nope'] }, { type: 'payment', ids: ['nope'] }, { type: 'payslip', ids: ['nope'] }], transfer_date: tomorrow() } });
    expect(res.status()).toBe(422);
    expect((await res.json()).problems).toHaveLength(3);
    expect((await (await as('sato')).post('/api/transfers/batches', { data: { kind: 'monthly', items: [{ type: 'payment', ids: ['x'] }], transfer_date: tomorrow() } })).status()).toBe(403);
  });

  test('取り消すと、全部が再び選べる。ファイルに入った経費は個別に返金・削除できない', async ({ as }) => {
    const s = await setUpMonth(as);
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s), transfer_date: tomorrow() } })).json();
    const rb = await keiri.post('/api/expenses/reimburse', { data: { ids: [s.c1.id], mode: 'separate' } });
    expect((await rb.json())).toMatchObject({ reimbursed: 0, skipped: 1 });
    expect((await keiri.delete(`/api/expenses/${s.c1.id}`)).status()).toBe(409);
    expect((await keiri.delete(`/api/transfers/batches/${made.id}`)).status()).toBe(200);
    expect(await db.payslips.count({ where: { batch_id: { not: null } } })).toBe(0);
    expect(await db.expense_claims.count({ where: { batch_id: { not: null } } })).toBe(0);
    expect(await db.payment_requests.count({ where: { batch_id: { not: null } } })).toBe(0);
    expect((await keiri.post('/api/transfers/batches', { data: { kind: 'monthly', items: everything(s), transfer_date: tomorrow() } })).status()).toBe(201);
  });
});

test.describe('画面', () => {
  test.use({ storageState: AUTH.keiri });

  test('「月次まとめ」が最初のタブ。一覧から全部を選んで、1つの全銀データを作り、履歴に出る', async ({ page, as }) => {
    await setUpMonth(as);
    await page.goto('/transfers');
    await expect(page.getByRole('button', { name: '月次まとめ' })).toHaveClass(/border-blue-600/);
    // the month shows the next month so that the expenses are in it
    await page.getByLabel('次の月').click();
    await expect(page.getByTestId('monthly-totals')).toContainText('合計');
    await expect(page.getByText('業務委託費').first()).toBeVisible();
    await expect(page.getByText('役員報酬').first()).toBeVisible();
    await expect(page.getByText('振込申請').first()).toBeVisible();
    await page.getByRole('button', { name: '作成できるものをすべて選択' }).click();
    await page.getByRole('button', { name: '全銀データを作成…' }).click();
    await expect(page.getByText(/まとめて1つの総合振込データを作ります/)).toBeVisible();
    await page.getByRole('button', { name: '作成する' }).click();
    await expect(page.getByText('全銀データを作成しました')).toBeVisible();
    await page.getByRole('button', { name: '作成履歴' }).click();
    await expect(page.getByText('月次まとめ 5件')).toBeVisible();
    expect(await db.transfer_batches.count({ where: { kind: 'monthly' } })).toBe(1);
  });
});
