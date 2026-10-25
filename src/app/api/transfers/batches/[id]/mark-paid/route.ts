import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { isValidDateString, jstDateString, toDbDate } from '@/lib/work';
import { settleClaimsOfPayslip } from '@/lib/expense-payslip';
import { notifyExpenseReimbursed, notifyPaymentPaid, notifyPayslip } from '@/lib/work-notify';

const schema = z.object({ paid_date: z.string().refine(isValidDateString).optional(), note: z.string().trim().max(500).optional() });

// POST /api/transfers/batches/:id/mark-paid - the bank has executed the file: mark everything in it as paid at once.
// Payment requests become 振込済; pay statements become 支払済 (which also settles expenses merged into them).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const batch = await prisma.transfer_batches.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (batch.paid_at) return NextResponse.json({ error: 'already_paid' }, { status: 409 });
  const date = parsed.data.paid_date ?? jstDateString(new Date());

  // claim the batch first so a double click can't process it twice
  const claimed = await prisma.transfer_batches.updateMany({ where: { id, paid_at: null }, data: { paid_at: toDbDate(date), paid_by_id: actor.id } });
  if (claimed.count === 0) return NextResponse.json({ error: 'already_paid' }, { status: 409 });

  let paidIds: string[] = [];
  const settledClaims: string[] = [];
  if (batch.kind === 'payment') {
    const reqs = await prisma.payment_requests.findMany({ where: { batch_id: id, status: 'approved' }, select: { id: true } });
    paidIds = reqs.map(r => r.id);
    await prisma.payment_requests.updateMany({
      where: { id: { in: paidIds }, status: 'approved' },
      data: { status: 'paid', paid_at: toDbDate(date), paid_by_id: actor.id, paid_note: parsed.data.note || `全銀データ ${batch.file_name}` },
    });
  } else {
    const slips = await prisma.payslips.findMany({ where: { batch_id: id, status: 'planned' }, select: { id: true } });
    paidIds = slips.map(s => s.id);
    for (const s of slips) {
      const ids = await prisma.$transaction(async tx => {
        const updated = await tx.payslips.update({ where: { id: s.id }, data: { status: 'paid', pay_date: toDbDate(date) } });
        return (await settleClaimsOfPayslip(tx, updated, actor.id)).ids;
      });
      settledClaims.push(...ids);
    }
  }
  await logAudit({
    actorUserId: actor.id, actionType: 'transfer_batch_paid', targetType: 'transfer_batches', targetId: id,
    metadata: { kind: batch.kind, count: paidIds.length, total: batch.total_amount, date },
  });
  if (batch.kind === 'payment') void notifyPaymentPaid(paidIds, date);
  else {
    for (const sid of paidIds) void notifyPayslip(sid, 'paid');
    if (settledClaims.length) void notifyExpenseReimbursed(settledClaims, date, '給与明細に合算');
  }
  return NextResponse.json({ ok: true, paid: paidIds.length });
}
