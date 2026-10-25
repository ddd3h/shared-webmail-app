import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';
import { syncExpenseItem } from '@/lib/expense-payslip';

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

// POST /api/expenses/unlink - take claims back out of a statement that has not been paid yet (admin only)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const claims = await prisma.expense_claims.findMany({
    where: { id: { in: parsed.data.ids }, status: 'approved', payslip: { is: { status: 'planned', batch_id: null } } },
    select: { id: true, payslip_id: true },
  });
  const payslipIds = [...new Set(claims.map(c => c.payslip_id!))];
  await prisma.$transaction(async tx => {
    await tx.expense_claims.updateMany({ where: { id: { in: claims.map(c => c.id) } }, data: { payslip_id: null } });
    for (const id of payslipIds) await syncExpenseItem(tx, id);
  });
  await logAudit({
    actorUserId: actor.id, actionType: 'expense_detach_payslip', targetType: 'expense_claims',
    metadata: { ids: claims.map(c => c.id), payslips: payslipIds },
  });
  return NextResponse.json({ detached: claims.length, skipped: parsed.data.ids.length - claims.length });
}
