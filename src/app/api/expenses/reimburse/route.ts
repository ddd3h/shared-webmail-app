import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';
import { isValidDateString, jstDateString, toDbDate } from '@/lib/work';

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  paid_date: z.string().refine(isValidDateString).optional(),
  note: z.string().trim().max(500).optional(),
});

// POST /api/expenses/reimburse - mark approved out-of-pocket claims as paid back (admin only).
// Claims that are not approved/personal/unpaid are skipped and reported back.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { ids, paid_date, note } = parsed.data;

  const claims = await prisma.expense_claims.findMany({
    where: { id: { in: ids }, status: 'approved', payment_method: 'personal' },
    select: { id: true, user_id: true, amount: true },
  });
  const res = await prisma.expense_claims.updateMany({
    where: { id: { in: claims.map(c => c.id) }, status: 'approved' },
    data: {
      status: 'paid', reimbursed_at: toDbDate(paid_date ?? jstDateString(new Date())),
      reimbursed_by_id: actor.id, reimburse_note: note || null,
    },
  });
  await logAudit({
    actorUserId: actor.id, actionType: 'expense_reimburse', targetType: 'expense_claims',
    metadata: { ids: claims.map(c => c.id), total: claims.reduce((s, c) => s + c.amount, 0), users: [...new Set(claims.map(c => c.user_id))] },
  });
  return NextResponse.json({ reimbursed: res.count, skipped: ids.length - res.count });
}
