// "The bank has executed this file": mark everything in a batch as paid. Everything happens in ONE transaction,
// so a failure half way leaves the batch untouched and the action can simply be repeated.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { settleClaimsOfPayslip } from '@/lib/expense-payslip';
import { toDbDate } from '@/lib/work';
import { notifyExpenseReimbursed, notifyPaymentPaid, notifyPayslip } from '@/lib/work-notify';

type Tx = Prisma.TransactionClient;
type Batch = { id: string; kind: string; file_name: string };
export type Settled = { kind: 'payment' | 'payroll'; paidIds: string[]; settledClaimIds: string[] };

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

/** Returns null when somebody else already recorded this batch (the caller answers 409). */
export async function settleBatch(batch: Batch, date: string, note: string | undefined, actorId: string): Promise<Settled | null> {
  return prisma.$transaction(async tx => {
    // claim first: of two simultaneous requests only one gets count 1, the other rolls back untouched
    const claimed = await tx.transfer_batches.updateMany({ where: { id: batch.id, paid_at: null }, data: { paid_at: toDbDate(date), paid_by_id: actorId } });
    if (claimed.count === 0) return null;
    if (batch.kind === 'payment') return { kind: 'payment' as const, paidIds: await settlePayments(tx, batch, date, note, actorId), settledClaimIds: [] };
    const { ids, claimIds } = await settlePayslips(tx, batch, date, actorId);
    return { kind: 'payroll' as const, paidIds: ids, settledClaimIds: claimIds };
  });
}

/** Mattermost DMs go out after the commit; they never carry amounts or account details. */
export function notifySettled(s: Settled, date: string) {
  if (s.kind === 'payment') { void notifyPaymentPaid(s.paidIds, date); return; }
  for (const id of s.paidIds) void notifyPayslip(id, 'paid');
  if (s.settledClaimIds.length > 0) void notifyExpenseReimbursed(s.settledClaimIds, date, '給与明細に合算');
}
