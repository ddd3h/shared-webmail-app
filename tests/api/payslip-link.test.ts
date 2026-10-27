import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    payslips: { findUnique: vi.fn(), update: vi.fn() },
    payslip_items: { deleteMany: vi.fn() },
    expense_claims: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
      payslip_items: { deleteMany: vi.fn() },
      payslips: { update: vi.fn(async () => ({ id: 'p1', pay_date: null })) },
    })),
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1' })), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/work-auth', () => ({ getActor: vi.fn(async () => ({ id: 'u1', role: 'admin' })), isAdmin: (a: any) => a.role === 'admin', isFinance: (a: any) => a.role === 'admin' || !!a.is_accounting }));
vi.mock('@/lib/work-notify', () => ({
  notifyPayslip: vi.fn(), notifyExpenseReimbursed: vi.fn(), notifyExpenseAddedToPayslip: vi.fn(),
}));
vi.mock('@/lib/expense-payslip', () => ({ syncExpenseItem: vi.fn(), settleClaimsOfPayslip: vi.fn(), attachClaimsToPayslips: vi.fn() }));

import { prisma } from '@/lib/db';
import { notifyExpenseReimbursed, notifyPayslip, notifyExpenseAddedToPayslip } from '@/lib/work-notify';
import { settleClaimsOfPayslip, syncExpenseItem, attachClaimsToPayslips } from '@/lib/expense-payslip';
import { PUT } from '@/app/api/work/payslips/[id]/route';
import { POST as reimburse } from '@/app/api/expenses/reimburse/route';
import { POST as unlink } from '@/app/api/expenses/unlink/route';

const ctx = { params: Promise.resolve({ id: 'p1' }) };
const body = (o: object = {}) => ({ pay_month: '2026-10', title: '給与', status: 'paid', pay_date: '2026-10-25', note: null, items: [{ kind: 'earning', label: '基本給', amount: 300000 }], ...o });
const put = (b: object) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(b) }) as any, ctx);
const post = (fn: any, b: object) => fn(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as any);

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.expense_claims.count as any).mockResolvedValue(0);
});

describe('給与明細を支払済にしたとき', () => {
  it('planned→paidで、合算された立替金が返金済になり通知される', async () => {
    (prisma.payslips.findUnique as any).mockResolvedValue({ id: 'p1', user_id: 'u2', status: 'planned' });
    (settleClaimsOfPayslip as any).mockResolvedValue({ ids: ['c1'], date: '2026-10-25' });
    expect((await put(body())).status).toBe(200);
    expect(syncExpenseItem).toHaveBeenCalled();
    expect(settleClaimsOfPayslip).toHaveBeenCalled();
    expect(notifyExpenseReimbursed).toHaveBeenCalledWith(['c1'], '2026-10-25', '給与明細に合算');
  });
  it('支払日が空のまま支払済にすると、今日の日付が入る', async () => {
    (prisma.payslips.findUnique as any).mockResolvedValue({ id: 'p1', user_id: 'u2', status: 'planned' });
    const update = vi.fn(async () => ({ id: 'p1', pay_date: null }));
    (prisma.$transaction as any).mockImplementationOnce(async (fn: any) => fn({ payslip_items: { deleteMany: vi.fn() }, payslips: { update } }));
    (settleClaimsOfPayslip as any).mockResolvedValue({ ids: [], date: '' });
    await put(body({ pay_date: null }));
    const saved = (update.mock.calls[0] as any)[0].data.pay_date as Date;
    expect(saved.toISOString().slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('すでに支払済の明細を保存し直しても立替金は二重処理しない', async () => {
    (prisma.payslips.findUnique as any).mockResolvedValue({ id: 'p1', user_id: 'u2', status: 'paid' });
    await put(body());
    expect(settleClaimsOfPayslip).not.toHaveBeenCalled();
  });
  it('支払予定のままなら立替金は返金済にならない', async () => {
    (prisma.payslips.findUnique as any).mockResolvedValue({ id: 'p1', user_id: 'u2', status: 'planned' });
    await put(body({ status: 'planned' }));
    expect(settleClaimsOfPayslip).not.toHaveBeenCalled();
  });
  it('項目が空でも、立替金が合算されていれば保存できる。合算もなければ400', async () => {
    (prisma.payslips.findUnique as any).mockResolvedValue({ id: 'p1', user_id: 'u2', status: 'planned' });
    (prisma.expense_claims.count as any).mockResolvedValue(2);
    expect((await put(body({ status: 'planned', items: [] }))).status).toBe(200);
    (prisma.expense_claims.count as any).mockResolvedValue(0);
    expect((await put(body({ status: 'planned', items: [] }))).status).toBe(400);
  });
});

describe('立替金を給与明細に合算', () => {
  it('payslipモードは対象月が必須', async () => {
    expect((await post(reimburse, { ids: ['c1'], mode: 'payslip' })).status).toBe(400);
  });
  it('合算しても返金済にはならず、本人に通知する', async () => {
    (prisma.expense_claims.findMany as any).mockResolvedValue([{ id: 'c1', user_id: 'u2', amount: 1200 }]);
    (attachClaimsToPayslips as any).mockResolvedValue([{ user_id: 'u2', payslip_id: 'p1', created: false }]);
    const res = await post(reimburse, { ids: ['c1', 'c2'], mode: 'payslip', pay_month: '2026-10' });
    expect(await res.json()).toEqual({ reimbursed: 0, attached: 1, skipped: 1 });
    expect(prisma.expense_claims.updateMany).not.toHaveBeenCalled();
    expect(notifyExpenseAddedToPayslip).toHaveBeenCalledWith(['c1'], '2026-10');
    // 未処理(給与明細に未合算)の立替だけが対象
    expect((prisma.expense_claims.findMany as any).mock.calls[0][0].where).toMatchObject({ status: 'approved', payment_method: 'personal', payslip_id: null });
  });
});

describe('給与明細から外す', () => {
  it('支払予定の明細に合算されたものだけ外し、明細の行を再計算する', async () => {
    (prisma.expense_claims.findMany as any).mockResolvedValue([{ id: 'c1', payslip_id: 'p1' }, { id: 'c2', payslip_id: 'p1' }]);
    (prisma.$transaction as any).mockImplementationOnce(async (fn: any) => fn({ expense_claims: { updateMany: vi.fn() } }));
    const res = await post(unlink, { ids: ['c1', 'c2', 'c3'] });
    expect(await res.json()).toEqual({ detached: 2, skipped: 1 });
    expect((prisma.expense_claims.findMany as any).mock.calls[0][0].where).toMatchObject({ status: 'approved', payslip: { is: { status: 'planned' } } });
    expect(syncExpenseItem).toHaveBeenCalledTimes(1);
    expect(notifyPayslip).not.toHaveBeenCalled();
  });
});
