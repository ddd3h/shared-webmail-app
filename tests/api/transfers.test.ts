import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@/lib/db', () => {
  const tx: any = {
    transfer_batches: { create: vi.fn() },
    payment_requests: { updateMany: vi.fn() },
    payslips: { updateMany: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      user_bank_accounts: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
      users: { findMany: vi.fn(), count: vi.fn() },
      payslips: { findMany: vi.fn(), updateMany: vi.fn() },
      payment_requests: { findMany: vi.fn(), updateMany: vi.fn() },
      transfer_batches: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      __tx: tx,
    },
  };
});
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1' })), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/crypto', () => ({ encrypt: vi.fn(async (s: string) => `enc:${s}`), decrypt: vi.fn(async (s: string) => s.replace(/^enc:/, '')) }));
vi.mock('@/lib/settings', () => ({
  getSetting: vi.fn(async (k: string) => store.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
}));
vi.mock('@/lib/work-auth', () => ({
  getActor: vi.fn(), isAdmin: (a: any) => a.role === 'admin', isFinance: (a: any) => a.role === 'admin' || !!a.is_accounting,
}));
vi.mock('@/lib/work-notify', () => ({
  notifyBankAccountChanged: vi.fn(), notifyBankAccountVerified: vi.fn(), notifyPaymentPaid: vi.fn(), notifyPayslip: vi.fn(), notifyExpenseReimbursed: vi.fn(),
}));
vi.mock('@/lib/expense-payslip', () => ({ settleClaimsOfPayslip: vi.fn(async () => ({ ids: ['c1'], date: '2026-10-31' })) }));

import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getActor } from '@/lib/work-auth';
import { notifyBankAccountChanged, notifyBankAccountVerified, notifyPayslip, notifyExpenseReimbursed } from '@/lib/work-notify';
import { GET as getMine, PUT as putMine } from '@/app/api/bank-accounts/me/route';
import { GET as listAccounts } from '@/app/api/bank-accounts/route';
import { POST as verify } from '@/app/api/bank-accounts/[userId]/verify/route';
import { GET as getSettings, PUT as putSettings } from '@/app/api/zengin/settings/route';
import { GET as listBatches, POST as createBatch } from '@/app/api/transfers/batches/route';
import { POST as markPaid } from '@/app/api/transfers/batches/[id]/mark-paid/route';
import { DELETE as cancelBatch } from '@/app/api/transfers/batches/[id]/route';
import { GET as download } from '@/app/api/transfers/batches/[id]/download/route';

const db = prisma as any;
const actor = (o: object = {}) => ({ id: 'u1', name: '経理', role: 'user', worker_type: 'employee', is_accounting: false, ...o });
const finance = () => actor({ is_accounting: true });
const admin = () => actor({ role: 'admin' });
const json = (b: object, method = 'POST') => new Request('http://x', { method, body: JSON.stringify(b) }) as any;
const ctx = (id = 'b1') => ({ params: Promise.resolve({ id }) });
const tomorrow = () => new Date(Date.now() + 9 * 3600_000 + 86400_000).toISOString().slice(0, 10);

const ACCOUNT = { bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '234', account_type: 'ordinary', account_number: '1234567', account_holder: 'サトウ タロウ' };
const SETTINGS = { client_code: '1234567890', client_name: 'カ）サンプル', bank_code: '0001', bank_name: 'みずほ銀行', branch_code: '123', branch_name: '本店', account_type: 'ordinary', account_number: '7654321' };
const acctRow = (o: object = {}) => ({
  id: 'a1', user_id: 'u2', ...ACCOUNT, account_number_enc: 'enc:1234567', account_last4: '4567', verified_at: new Date(), ...o,
});

beforeEach(() => {
  vi.resetAllMocks();
  store.clear();
  db.$transaction.mockImplementation(async (fn: any) => fn(db.__tx));
  (getActor as any).mockResolvedValue(finance());
});

describe('受取口座（本人）', () => {
  it('登録すると暗号化して保存し、確認は未済・監査ログと通知を出す', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(null);
    db.user_bank_accounts.upsert.mockImplementation(async (a: any) => ({ id: 'a1', user_id: 'u1', ...a.create }));
    const res = await putMine(json(ACCOUNT, 'PUT'));
    expect(res.status).toBe(200);
    const data = db.user_bank_accounts.upsert.mock.calls[0][0].create;
    expect(data.account_number_enc).toBe('enc:1234567');
    expect(data.account_last4).toBe('4567');
    expect(data.verified_at).toBeNull();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'bank_account_change' }));
    expect(notifyBankAccountChanged).toHaveBeenCalledWith('u1');
  });

  it('同じ内容の保存では確認済を外さず、通知もしない', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(acctRow({ user_id: 'u1' }));
    db.user_bank_accounts.upsert.mockImplementation(async (a: any) => ({ id: 'a1', user_id: 'u1', ...acctRow(), ...a.update }));
    await putMine(json(ACCOUNT, 'PUT'));
    expect(db.user_bank_accounts.upsert.mock.calls[0][0].update).not.toHaveProperty('verified_at');
    expect(notifyBankAccountChanged).not.toHaveBeenCalled();
  });

  it('番号を変えると確認済が外れ、確認が外れたことを返す', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(acctRow({ user_id: 'u1' }));
    db.user_bank_accounts.upsert.mockImplementation(async (a: any) => ({ id: 'a1', user_id: 'u1', ...acctRow(), ...a.update }));
    const res = await putMine(json({ ...ACCOUNT, account_number: '7654321' }, 'PUT'));
    expect(db.user_bank_accounts.upsert.mock.calls[0][0].update).toMatchObject({ verified_at: null, verified_by_id: null });
    expect((await res.json()).verification_cleared).toBe(true);
  });

  const bad: [string, object][] = [
    ['銀行コード3桁', { bank_code: '001' }], ['支店コード4桁', { branch_code: '1234' }], ['番号3桁', { account_number: '123' }], ['番号8桁', { account_number: '12345678' }],
    ['番号に英字', { account_number: '12a4567' }], ['名義が漢字', { account_holder: '佐藤太郎' }], ['種目が不正', { account_type: 'x' }], ['銀行名が空', { bank_name: ' ' }],
  ];
  for (const [label, over] of bad) {
    it(`不正な入力は400: ${label}`, async () => {
      const res = await putMine(json({ ...ACCOUNT, ...over }, 'PUT'));
      expect(res.status).toBe(400);
      expect(db.user_bank_accounts.upsert).not.toHaveBeenCalled();
    });
  }

  it('銀行名・支店名は漢字のままでよい', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(null);
    db.user_bank_accounts.upsert.mockImplementation(async (a: any) => ({ id: 'a1', user_id: 'u1', ...a.create }));
    expect((await putMine(json(ACCOUNT, 'PUT'))).status).toBe(200);
  });

  it('GET: 本人には口座番号まで返す。未登録ならnull', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(acctRow({ user_id: 'u1' }));
    expect((await (await getMine()).json()).account.account_number).toBe('1234567');
    db.user_bank_accounts.findUnique.mockResolvedValue(null);
    expect((await (await getMine()).json()).account).toBeNull();
  });
});

describe('受取口座の一覧・確認（経理担当）', () => {
  it('一般ユーザーは一覧を見られない', async () => {
    (getActor as any).mockResolvedValue(actor());
    expect((await listAccounts()).status).toBe(403);
  });
  it('経理担当は全員分を口座番号つきで見られる', async () => {
    db.users.findMany.mockResolvedValue([{ id: 'u2', name: '佐藤', worker_type: 'employee', bank_account: acctRow() }, { id: 'u3', name: '鈴木', worker_type: 'contractor', bank_account: null }]);
    const body = await (await listAccounts()).json();
    expect(body.items[0].account.account_number).toBe('1234567');
    expect(body.items[1].account).toBeNull();
  });
  it('確認すると確認者・日時を記録し、本人に通知する', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(acctRow());
    const res = await verify(json({}), { params: Promise.resolve({ userId: 'u2' }) });
    expect(res.status).toBe(200);
    expect(db.user_bank_accounts.update.mock.calls[0][0].data).toMatchObject({ verified_by_id: 'u1' });
    expect(notifyBankAccountVerified).toHaveBeenCalledWith('u2');
  });
  it('一般ユーザーは確認できない', async () => {
    (getActor as any).mockResolvedValue(actor());
    expect((await verify(json({}), { params: Promise.resolve({ userId: 'u2' }) })).status).toBe(403);
  });
  it('他に確認できる人がいれば、自分の口座は自分で確認できない', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(acctRow({ user_id: 'u1' }));
    db.users.count.mockResolvedValue(1);
    expect((await verify(json({}), { params: Promise.resolve({ userId: 'u1' }) })).status).toBe(403);
    expect(db.user_bank_accounts.update).not.toHaveBeenCalled();
  });
  it('確認できる人が自分しかいなければ、自分の口座も確認できる', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(acctRow({ user_id: 'u1' }));
    db.users.count.mockResolvedValue(0);
    expect((await verify(json({}), { params: Promise.resolve({ userId: 'u1' }) })).status).toBe(200);
  });
  it('口座がなければ404', async () => {
    db.user_bank_accounts.findUnique.mockResolvedValue(null);
    expect((await verify(json({}), { params: Promise.resolve({ userId: 'u9' }) })).status).toBe(404);
  });
});

describe('全銀の設定', () => {
  it('管理者だけが保存でき、委託者コードと口座番号は暗号化される', async () => {
    (getActor as any).mockResolvedValue(finance());
    expect((await putSettings(json(SETTINGS, 'PUT'))).status).toBe(403);
    (getActor as any).mockResolvedValue(admin());
    expect((await putSettings(json(SETTINGS, 'PUT'))).status).toBe(200);
    expect(store.get('ZENGIN_CLIENT_CODE')).toBe('enc:1234567890');
    expect(store.get('ZENGIN_ACCOUNT_NUMBER')).toBe('enc:7654321');
    expect(store.get('ZENGIN_BANK_CODE')).toBe('0001');
  });
  it('口座番号は7桁にゼロ埋めされる', async () => {
    (getActor as any).mockResolvedValue(admin());
    await putSettings(json({ ...SETTINGS, account_number: '4321' }, 'PUT'));
    expect(store.get('ZENGIN_ACCOUNT_NUMBER')).toBe('enc:0004321');
  });
  it('経理担当には値を返さず、設定済みかどうかだけ', async () => {
    (getActor as any).mockResolvedValue(admin());
    await putSettings(json(SETTINGS, 'PUT'));
    (getActor as any).mockResolvedValue(finance());
    const body = await (await getSettings()).json();
    expect(body.configured).toBe(true);
    expect(body.settings.client_code).toBeUndefined();
    expect(body.settings.account_number).toBeUndefined();
  });
  it('一般ユーザーは見られない', async () => {
    (getActor as any).mockResolvedValue(actor());
    expect((await getSettings()).status).toBe(403);
  });
  for (const [label, over] of [['委託者コード9桁', { client_code: '123456789' }], ['委託者名が漢字', { client_name: '会社' }], ['銀行コード5桁', { bank_code: '00012' }], ['支店コード2桁', { branch_code: '12' }]] as [string, object][]) {
    it(`不正な設定は400: ${label}`, async () => {
      (getActor as any).mockResolvedValue(admin());
      expect((await putSettings(json({ ...SETTINGS, ...over }, 'PUT'))).status).toBe(400);
    });
  }
});

const configure = async () => {
  (getActor as any).mockResolvedValue(admin());
  await putSettings(json(SETTINGS, 'PUT'));
  (getActor as any).mockResolvedValue(finance());
};
const slip = (o: object = {}) => ({
  id: 's1', pay_month: '2026-10', title: '給与', status: 'planned', batch_id: null, user: { name: '佐藤', bank_account: acctRow() },
  items: [{ kind: 'earning', label: '基本給', amount: 300000, system_key: null }, { kind: 'deduction', label: '社保', amount: 45000, system_key: null }], ...o,
});

describe('全銀データの作成', () => {
  it('一般ユーザーは作れない', async () => {
    (getActor as any).mockResolvedValue(actor());
    expect((await createBatch(json({ kind: 'payroll', ids: ['s1'], transfer_date: tomorrow() }))).status).toBe(403);
    expect((await listBatches()).status).toBe(403);
  });

  it('設定が未完了なら422（zengin_settings）', async () => {
    const res = await createBatch(json({ kind: 'payroll', ids: ['s1'], transfer_date: tomorrow() }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('zengin_settings');
  });

  it('給与: 実額（総支給−控除）で、120バイト×CRLFのファイルを保存し、明細にbatch_idを付ける', async () => {
    await configure();
    db.payslips.findMany.mockResolvedValue([slip()]);
    db.__tx.transfer_batches.create.mockImplementation(async (a: any) => ({ id: 'b1', ...a.data }));
    const res = await createBatch(json({ kind: 'payroll', ids: ['s1'], transfer_date: tomorrow() }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'b1', count: 1, total: 255000 });
    const saved = db.__tx.transfer_batches.create.mock.calls[0][0].data;
    expect(saved).toMatchObject({ kind: 'payroll', category_code: '11', item_count: 1, total_amount: 255000, created_by_id: 'u1' });
    const bytes = Buffer.from(saved.content_b64, 'base64');
    expect(bytes.length).toBe(122 * 4); // header, data, trailer, end
    expect(bytes.toString('latin1').split('\r\n')[1].slice(80, 90)).toBe('0000255000');
    expect(db.__tx.payslips.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['s1'] } }, data: { batch_id: 'b1' } });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'transfer_batch_create' }));
  });

  it('1件でも問題があれば、全件の問題を返して何も作らない', async () => {
    await configure();
    db.payslips.findMany.mockResolvedValue([
      slip({ id: 's1' }),
      slip({ id: 's2', user: { name: '鈴木', bank_account: null } }),
      slip({ id: 's3', user: { name: '田中', bank_account: acctRow({ verified_at: null }) } }),
      slip({ id: 's4', status: 'paid' }),
      slip({ id: 's5', batch_id: 'old' }),
    ]);
    const res = await createBatch(json({ kind: 'payroll', ids: ['s1', 's2', 's3', 's4', 's5', 's6'], transfer_date: tomorrow() }));
    expect(res.status).toBe(422);
    const { problems } = await res.json();
    expect(problems.map((p: any) => p.id)).toEqual(['s2', 's3', 's4', 's5', 's6']);
    expect(problems[0].reason).toContain('登録されていません');
    expect(problems[1].reason).toContain('未確認');
    expect(problems[3].reason).toContain('二重振込');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('force を付けると作成済みの明細も含められる', async () => {
    await configure();
    db.payslips.findMany.mockResolvedValue([slip({ batch_id: 'old' })]);
    db.__tx.transfer_batches.create.mockImplementation(async (a: any) => ({ id: 'b2', ...a.data }));
    expect((await createBatch(json({ kind: 'payroll', ids: ['s1'], transfer_date: tomorrow(), force: true }))).status).toBe(201);
  });

  it('同じIDは1件に数える', async () => {
    await configure();
    db.payslips.findMany.mockResolvedValue([slip()]);
    db.__tx.transfer_batches.create.mockImplementation(async (a: any) => ({ id: 'b1', ...a.data }));
    expect((await (await createBatch(json({ kind: 'payroll', ids: ['s1', 's1'], transfer_date: tomorrow() }))).json()).count).toBe(1);
  });

  it('振込指定日が過去・不正なら400', async () => {
    for (const d of ['2020-01-01', '2026-02-30', 'x', '']) {
      expect((await createBatch(json({ kind: 'payroll', ids: ['s1'], transfer_date: d }))).status, d).toBe(400);
    }
  });

  it('賞与は種別12、給与の画面から総合(21)は選べるが支払は常に21', async () => {
    await configure();
    db.payslips.findMany.mockResolvedValue([slip()]);
    db.__tx.transfer_batches.create.mockImplementation(async (a: any) => ({ id: 'b1', ...a.data }));
    await createBatch(json({ kind: 'payroll', ids: ['s1'], category: '12', transfer_date: tomorrow() }));
    expect(db.__tx.transfer_batches.create.mock.calls[0][0].data.category_code).toBe('12');
    db.payment_requests.findMany.mockResolvedValue([{
      id: 'p1', title: '外注費', status: 'approved', batch_id: null, amount: 110000, deduction_amount: 0, fee: 0, fee_bearer: 'us',
      vendor: { name: 'A社', verified_at: new Date(), bank_code: '0001', bank_name: 'みずほ銀行', branch_code: '123', branch_name: '新宿支店', account_type: 'ordinary', account_number_enc: 'enc:3141592', account_holder: 'カ）エー' },
    }]);
    db.__tx.transfer_batches.create.mockClear();
    db.__tx.transfer_batches.create.mockImplementation(async (a: any) => ({ id: 'b3', ...a.data }));
    const res = await createBatch(json({ kind: 'payment', ids: ['p1'], category: '11', transfer_date: tomorrow() }));
    expect(res.status).toBe(201);
    expect(db.__tx.transfer_batches.create.mock.calls[0][0].data.category_code).toBe('21');
    expect(db.__tx.payment_requests.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } }, data: { batch_id: 'b3' } });
  });

  it('支払: 口座未確認・未承認・名義が使えない文字の申請を問題として返す', async () => {
    await configure();
    const vendor = (o: object = {}) => ({ name: 'A社', verified_at: new Date(), bank_code: '0001', bank_name: 'x', branch_code: '123', branch_name: 'y', account_type: 'ordinary', account_number_enc: 'enc:3141592', account_holder: 'カ）エー', ...o });
    const r = (id: string, o: object = {}, v: object = {}) => ({ id, title: 't', status: 'approved', batch_id: null, amount: 1000, deduction_amount: 0, fee: 0, fee_bearer: 'us', vendor: vendor(v), ...o });
    db.payment_requests.findMany.mockResolvedValue([r('p1', {}, { verified_at: null }), r('p2', { status: 'pending' }), r('p3', {}, { account_holder: '株式会社' }), r('p4', { amount: 0 })]);
    const res = await createBatch(json({ kind: 'payment', ids: ['p1', 'p2', 'p3', 'p4'], transfer_date: tomorrow() }));
    expect(res.status).toBe(422);
    expect((await res.json()).problems.map((p: any) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});

describe('ダウンロード・記録・取り消し', () => {
  const batch = (o: object = {}) => ({ id: 'b1', kind: 'payroll', file_name: 'f.txt', content_b64: Buffer.from('abc').toString('base64'), item_count: 1, total_amount: 255000, paid_at: null, ...o });

  it('ダウンロードは保存したバイト列そのもの。一般ユーザーは403。ログが残る', async () => {
    db.transfer_batches.findUnique.mockResolvedValue(batch());
    const res = await download(new Request('http://x') as any, ctx());
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('abc');
    expect(res.headers.get('content-disposition')).toContain('f.txt');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'transfer_batch_download' }));
    (getActor as any).mockResolvedValue(actor());
    expect((await download(new Request('http://x') as any, ctx())).status).toBe(403);
  });

  it('給与の記録: 明細を支払済にし、合算した経費も精算して通知する', async () => {
    db.transfer_batches.findUnique.mockResolvedValue(batch());
    db.transfer_batches.updateMany.mockResolvedValue({ count: 1 });
    db.payslips.findMany.mockResolvedValue([{ id: 's1' }]);
    db.__tx.payslips.update.mockResolvedValue({ id: 's1', pay_date: null });
    const res = await markPaid(json({ paid_date: '2026-10-31' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).paid).toBe(1);
    expect(db.__tx.payslips.update.mock.calls[0][0].data.status).toBe('paid');
    expect(notifyPayslip).toHaveBeenCalledWith('s1', 'paid');
    expect(notifyExpenseReimbursed).toHaveBeenCalledWith(['c1'], '2026-10-31', '給与明細に合算');
  });

  it('支払の記録: 申請を振込済にする', async () => {
    db.transfer_batches.findUnique.mockResolvedValue(batch({ kind: 'payment' }));
    db.transfer_batches.updateMany.mockResolvedValue({ count: 1 });
    db.payment_requests.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const res = await markPaid(json({}), ctx());
    expect((await res.json()).paid).toBe(2);
    expect(db.payment_requests.updateMany.mock.calls[0][0].data.status).toBe('paid');
  });

  it('すでに記録済み・同時の2回目は409で何もしない', async () => {
    db.transfer_batches.findUnique.mockResolvedValue(batch({ paid_at: new Date() }));
    expect((await markPaid(json({}), ctx())).status).toBe(409);
    db.transfer_batches.findUnique.mockResolvedValue(batch());
    db.transfer_batches.updateMany.mockResolvedValue({ count: 0 }); // somebody else claimed it first
    expect((await markPaid(json({}), ctx())).status).toBe(409);
    expect(db.payslips.findMany).not.toHaveBeenCalled();
  });

  it('不正な日付は400、存在しない・一般ユーザーは404/403', async () => {
    expect((await markPaid(json({ paid_date: '2026-13-40' }), ctx())).status).toBe(400);
    db.transfer_batches.findUnique.mockResolvedValue(null);
    expect((await markPaid(json({}), ctx())).status).toBe(404);
    (getActor as any).mockResolvedValue(actor());
    expect((await markPaid(json({}), ctx())).status).toBe(403);
  });

  it('取り消し: 未記録なら削除、記録済みなら409、一般ユーザーは403', async () => {
    db.transfer_batches.findUnique.mockResolvedValue(batch());
    expect((await cancelBatch(json({}, 'DELETE'), ctx())).status).toBe(200);
    expect(db.transfer_batches.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    db.transfer_batches.findUnique.mockResolvedValue(batch({ paid_at: new Date() }));
    expect((await cancelBatch(json({}, 'DELETE'), ctx())).status).toBe(409);
    (getActor as any).mockResolvedValue(actor());
    expect((await cancelBatch(json({}, 'DELETE'), ctx())).status).toBe(403);
  });
});
