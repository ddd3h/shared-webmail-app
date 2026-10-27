import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SCHEDULES } from '@/lib/pay-schedule';

vi.mock('@/lib/pay-schedule-server', () => ({ loadSchedules: vi.fn(async () => ({ schedules: DEFAULT_SCHEDULES, custom: new Set() })) }));
import { attachClaimsToPayslips, settleClaimsOfPayslip, syncExpenseItem } from '@/lib/expense-payslip';

function fakeTx(over: Record<string, any> = {}) {
  return {
    expense_claims: { findMany: vi.fn(), updateMany: vi.fn() },
    payslip_items: { deleteMany: vi.fn(), create: vi.fn() },
    payslips: { findMany: vi.fn(), create: vi.fn() },
    users: { findUnique: vi.fn(async () => ({ worker_type: 'employee' })) },
    ...over,
  } as any;
}

describe('syncExpenseItem', () => {
  it('合算された立替金の合計を「立替金精算」行として作り直す', async () => {
    const tx = fakeTx();
    tx.expense_claims.findMany.mockResolvedValue([{ amount: 1200 }, { amount: 800 }]);
    await syncExpenseItem(tx, 'p1');
    expect(tx.payslip_items.deleteMany).toHaveBeenCalledWith({ where: { payslip_id: 'p1', system_key: 'expense_reimbursement' } });
    expect(tx.payslip_items.create.mock.calls[0][0].data).toMatchObject({ kind: 'earning', amount: 2000, label: '立替金精算（2件）', system_key: 'expense_reimbursement' });
  });
  it('合算分がなくなったら行を消すだけ', async () => {
    const tx = fakeTx();
    tx.expense_claims.findMany.mockResolvedValue([]);
    await syncExpenseItem(tx, 'p1');
    expect(tx.payslip_items.deleteMany).toHaveBeenCalled();
    expect(tx.payslip_items.create).not.toHaveBeenCalled();
  });
});

describe('attachClaimsToPayslips', () => {
  it('支払予定の給与明細があればそこに合算する（新規作成しない）', async () => {
    const tx = fakeTx();
    tx.payslips.findMany.mockResolvedValue([{ id: 'p1', title: '給与', status: 'planned' }]);
    tx.expense_claims.findMany.mockResolvedValue([{ amount: 500 }]);
    const res = await attachClaimsToPayslips(tx, [{ id: 'c1', user_id: 'u2' }], '2026-10', 'admin');
    expect(tx.payslips.create).not.toHaveBeenCalled();
    expect(tx.expense_claims.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['c1'] }, status: 'approved', payslip_id: null }, data: { payslip_id: 'p1' } });
    expect(res).toEqual([{ user_id: 'u2', payslip_id: 'p1', created: false }]);
  });
  it('明細がなければ「立替金精算」の明細を作る', async () => {
    const tx = fakeTx();
    tx.payslips.findMany.mockResolvedValue([]);
    tx.payslips.create.mockResolvedValue({ id: 'new', title: '立替金精算', status: 'planned' });
    tx.expense_claims.findMany.mockResolvedValue([{ amount: 500 }]);
    const res = await attachClaimsToPayslips(tx, [{ id: 'c1', user_id: 'u2' }], '2026-10', 'admin');
    expect(tx.payslips.create.mock.calls[0][0].data).toMatchObject({ user_id: 'u2', pay_month: '2026-10', title: '立替金精算', status: 'planned' });
    // the new statement is paid on the 振込日 of the claimant's kind of worker (末締め翌月25日払い: 10月分 -> 11/25)
    expect(tx.payslips.create.mock.calls[0][0].data.pay_date.toISOString().slice(0, 10)).toBe('2026-11-25');
    expect(res[0]).toMatchObject({ payslip_id: 'new', created: true });
  });
  it('人ごとに別々の明細へ合算する', async () => {
    const tx = fakeTx();
    tx.payslips.findMany.mockImplementation(async ({ where }: any) => [{ id: `p-${where.user_id}`, title: '給与', status: 'planned' }]);
    tx.expense_claims.findMany.mockResolvedValue([{ amount: 1 }]);
    const res = await attachClaimsToPayslips(tx, [{ id: 'c1', user_id: 'u2' }, { id: 'c2', user_id: 'u3' }, { id: 'c3', user_id: 'u2' }], '2026-10', 'admin');
    expect(res.map(r => r.payslip_id).sort()).toEqual(['p-u2', 'p-u3']);
    expect(tx.expense_claims.updateMany.mock.calls.find((c: any) => c[0].data.payslip_id === 'p-u2')[0].where.id.in).toEqual(['c1', 'c3']);
  });
});

describe('settleClaimsOfPayslip', () => {
  it('明細が支払済になると、合算された承認済の立替を返金済にする', async () => {
    const tx = fakeTx();
    tx.expense_claims.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const res = await settleClaimsOfPayslip(tx, { id: 'p1', pay_date: new Date('2026-10-25T00:00:00Z') }, 'admin');
    expect(res).toEqual({ ids: ['c1', 'c2'], date: '2026-10-25' });
    expect(tx.expense_claims.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'paid', reimbursed_by_id: 'admin' });
  });
  it('合算分がなければ何もしない', async () => {
    const tx = fakeTx();
    tx.expense_claims.findMany.mockResolvedValue([]);
    expect((await settleClaimsOfPayslip(tx, { id: 'p1', pay_date: null }, 'admin')).ids).toEqual([]);
    expect(tx.expense_claims.updateMany).not.toHaveBeenCalled();
  });
});
