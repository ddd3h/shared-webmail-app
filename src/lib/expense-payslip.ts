// Keeps expense reimbursements and pay statements in sync. All functions take the
// caller's transaction client so a half-applied merge can never be committed.
import type { Prisma } from '@prisma/client';
import { EXPENSE_ITEM_KEY, EXPENSE_ITEM_LABEL, pickPayslip } from '@/lib/expense';
import { jstDateString, toDbDate, type WorkerType } from '@/lib/work';
import { DEFAULT_SCHEDULES, payDate } from '@/lib/pay-schedule';
import { loadSchedules } from '@/lib/pay-schedule-server';

type Tx = Prisma.TransactionClient;

// Re-computes the system "立替金精算" line of a statement from the claims attached to it.
export async function syncExpenseItem(tx: Tx, payslipId: string) {
  const claims = await tx.expense_claims.findMany({ where: { payslip_id: payslipId }, select: { amount: true } });
  await tx.payslip_items.deleteMany({ where: { payslip_id: payslipId, system_key: EXPENSE_ITEM_KEY } });
  if (claims.length === 0) return;
  await tx.payslip_items.create({
    data: {
      payslip_id: payslipId, kind: 'earning', system_key: EXPENSE_ITEM_KEY, sort: 1000,
      label: `${EXPENSE_ITEM_LABEL}（${claims.length}件）`,
      amount: claims.reduce((s, c) => s + c.amount, 0),
    },
  });
}

// Merges approved out-of-pocket claims into each person's statement for `payMonth`
// (creating a "立替金精算" statement when they have no unpaid one). Returns the touched statements.
export async function attachClaimsToPayslips(
  tx: Tx,
  claims: { id: string; user_id: string }[],
  payMonth: string,
  actorId: string
) {
  const byUser = new Map<string, string[]>();
  for (const c of claims) byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c.id]);

  const touched: { user_id: string; payslip_id: string; created: boolean }[] = [];
  const { schedules } = await loadSchedules();
  for (const [userId, ids] of byUser) {
    const candidates = await tx.payslips.findMany({
      // a statement already inside a 全銀 file is closed: adding a line would change an amount the file doesn't contain
      where: { user_id: userId, pay_month: payMonth, status: 'planned', batch_id: null },
      orderBy: { created_at: 'asc' },
      select: { id: true, title: true, status: true },
    });
    let target = pickPayslip(candidates);
    let created = false;
    if (!target) {
      // a new statement gets the pay date of the claimant's kind of worker (締め日・振込日)
      const type = ((await tx.users.findUnique({ where: { id: userId }, select: { worker_type: true } }))?.worker_type ?? 'employee') as WorkerType;
      target = await tx.payslips.create({
        data: { user_id: userId, pay_month: payMonth, title: EXPENSE_ITEM_LABEL, status: 'planned', created_by_id: actorId, pay_date: toDbDate(payDate(payMonth, schedules[type] ?? DEFAULT_SCHEDULES.employee)) },
        select: { id: true, title: true, status: true },
      });
      created = true;
    }
    await tx.expense_claims.updateMany({ where: { id: { in: ids }, status: 'approved', payslip_id: null }, data: { payslip_id: target.id } });
    await syncExpenseItem(tx, target.id);
    touched.push({ user_id: userId, payslip_id: target.id, created });
  }
  return touched;
}

// A statement became "paid": the claims merged into it are paid back now.
export async function settleClaimsOfPayslip(tx: Tx, payslip: { id: string; pay_date: Date | null }, actorId: string) {
  const claims = await tx.expense_claims.findMany({
    where: { payslip_id: payslip.id, status: 'approved' },
    select: { id: true },
  });
  if (claims.length === 0) return { ids: [] as string[], date: '' };
  const date = payslip.pay_date ? payslip.pay_date.toISOString().slice(0, 10) : jstDateString(new Date());
  await tx.expense_claims.updateMany({
    where: { id: { in: claims.map(c => c.id) }, status: 'approved' },
    data: { status: 'paid', reimbursed_at: toDbDate(date), reimbursed_by_id: actorId, reimburse_note: '給与明細に合算して支払い' },
  });
  return { ids: claims.map(c => c.id), date };
}
