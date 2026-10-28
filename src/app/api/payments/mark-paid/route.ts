import { triggerFreeeSync } from '@/lib/freee-sync';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { isValidDateString, jstDateString, toDbDate } from '@/lib/work';
import { transferAmount } from '@/lib/payment';
import { notifyPaymentPaid } from '@/lib/work-notify';

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  paid_date: z.string().refine(isValidDateString).optional(),
  note: z.string().trim().max(500).optional(),
});

// POST /api/payments/mark-paid - record that approved requests were transferred (finance staff).
// Requests that are not approved, or whose payee account is no longer verified, are skipped and reported back.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { ids, paid_date, note } = parsed.data;
  const date = paid_date ?? jstDateString(new Date());

  const rows = await prisma.payment_requests.findMany({
    where: { id: { in: ids }, status: 'approved', vendor: { verified_at: { not: null } } },
    select: { id: true, amount: true, deduction_amount: true, fee: true, fee_bearer: true },
  });
  const res = await prisma.payment_requests.updateMany({
    where: { id: { in: rows.map(r => r.id) }, status: 'approved' },
    data: { status: 'paid', paid_at: toDbDate(date), paid_by_id: actor.id, paid_note: note || null },
  });
  await logAudit({
    actorUserId: actor.id, actionType: 'payment_mark_paid', targetType: 'payment_requests',
    metadata: { ids: rows.map(r => r.id), total: rows.reduce((s, r) => s + transferAmount(r), 0), date },
  });
  if (res.count > 0) void notifyPaymentPaid(rows.map(r => r.id), date);
  if (res.count > 0) triggerFreeeSync();
  return NextResponse.json({ paid: res.count, skipped: ids.length - res.count });
}
