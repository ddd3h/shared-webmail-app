// "The bank has executed this file": mark everything in a batch as paid. Everything happens in ONE transaction,
// so a failure half way leaves the batch untouched and the action can simply be repeated.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { settleClaimsOfPayslip } from '@/lib/expense-payslip';
import { toDbDate } from '@/lib/work';
import { notifyExpenseReimbursed, notifyPaymentPaid, notifyPayslip } from '@/lib/work-notify';

type Tx = Prisma.TransactionClient;
type Batch = { id: string; kind: string; file_name: string };
export type Settled = { kind: 'payment' | 'payroll' | 'monthly'; paidIds: string[]; settledClaimIds: string[]; payments?: string[]; payslips?: string[]; claims?: string[] };

async function settlePayments(tx: Tx, batch: Batch, date: string, note: string | undefined, actorId: string): Promise<string[]> {
  const rows = await tx.payment_requests.findMany({ where: { batch_id: batch.id, status: 'approved' }, select: { id: true } });
  const ids = rows.map(r => r.id);
  await tx.payment_requests.updateMany({
    where: { id: { in: ids }, status: 'approved' },
    data: { status: 'paid', paid_at: toDbDate(date), paid_by_id: actorId, paid_note: note || `全銀データ ${batch.file_name}` },
  });
  return ids;
}

/** Pays each statement, and (through settleClaimsOfPayslip) the expenses that were merged into it. */
async function settlePayslips(tx: Tx, batch: Batch, date: string, actorId: string): Promise<{ ids: string[]; claimIds: string[] }> {
  const slips = await tx.payslips.findMany({ where: { batch_id: batch.id, status: 'planned' }, select: { id: true } });
  const claimIds: string[] = [];
  for (const s of slips) {
    const updated = await tx.payslips.update({ where: { id: s.id }, data: { status: 'paid', pay_date: toDbDate(date) } });
    claimIds.push(...(await settleClaimsOfPayslip(tx, updated, actorId)).ids);
  }
  return { ids: slips.map(s => s.id), claimIds };
}

/** Expenses that were paid back by a monthly file: paid on the day of the transfer. */
async function settleExpenses(tx: Tx, batch: Batch, date: string, actorId: string): Promise<string[]> {
  const rows = await tx.expense_claims.findMany({ where: { batch_id: batch.id, status: 'approved' }, select: { id: true } });
  const ids = rows.map(r => r.id);
  await tx.expense_claims.updateMany({
    where: { id: { in: ids }, status: 'approved' },
    data: { status: 'paid', reimbursed_at: toDbDate(date), reimbursed_by_id: actorId, reimburse_note: `全銀データ ${batch.file_name}` },
  });
  return ids;
}

/** Returns null when somebody else already recorded this batch (the caller answers 409). */
export async function settleBatch(batch: Batch, date: string, note: string | undefined, actorId: string): Promise<Settled | null> {
  return prisma.$transaction(async tx => {
    // claim first: of two simultaneous requests only one gets count 1, the other rolls back untouched
    const claimed = await tx.transfer_batches.updateMany({ where: { id: batch.id, paid_at: null }, data: { paid_at: toDbDate(date), paid_by_id: actorId } });
    if (claimed.count === 0) return null;
    if (batch.kind === 'monthly') {
      const payments = await settlePayments(tx, batch, date, note, actorId);
      const { ids: payslips, claimIds } = await settlePayslips(tx, batch, date, actorId);
      const claims = await settleExpenses(tx, batch, date, actorId);
      return { kind: 'monthly' as const, paidIds: [...payments, ...payslips, ...claims], settledClaimIds: claimIds, payments, payslips, claims };
    }
    if (batch.kind === 'payment') return { kind: 'payment' as const, paidIds: await settlePayments(tx, batch, date, note, actorId), settledClaimIds: [] };
    const { ids, claimIds } = await settlePayslips(tx, batch, date, actorId);
    return { kind: 'payroll' as const, paidIds: ids, settledClaimIds: claimIds };
  });
}

/** Mattermost DMs go out after the commit; they never carry amounts or account details. */
export function notifySettled(s: Settled, date: string) {
  if (s.kind === 'monthly') {
    if (s.payments?.length) void notifyPaymentPaid(s.payments, date);
    for (const id of s.payslips ?? []) void notifyPayslip(id, 'paid');
    const merged = s.settledClaimIds, own = s.claims ?? [];
    if (merged.length > 0) void notifyExpenseReimbursed(merged, date, '給与明細に合算');
    if (own.length > 0) void notifyExpenseReimbursed(own, date, '全銀データで振込');
    return;
  }
  if (s.kind === 'payment') { void notifyPaymentPaid(s.paidIds, date); return; }
  for (const id of s.paidIds) void notifyPayslip(id, 'paid');
  if (s.settledClaimIds.length > 0) void notifyExpenseReimbursed(s.settledClaimIds, date, '給与明細に合算');
}
