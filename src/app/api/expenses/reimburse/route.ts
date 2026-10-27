import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { notifyExpenseAddedToPayslip, notifyExpenseReimbursed } from '@/lib/work-notify';
import { attachClaimsToPayslips } from '@/lib/expense-payslip';
import { isValidDateString, isValidMonth, jstDateString, toDbDate } from '@/lib/work';

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  // 'separate': paid back outside the app -> paid now.
  // 'payslip': merged into the person's pay statement for `pay_month`; becomes paid when that statement is paid.
  mode: z.enum(['separate', 'payslip']).default('separate'),
  paid_date: z.string().refine(isValidDateString).optional(),
  pay_month: z.string().refine(isValidMonth).optional(),
  note: z.string().trim().max(500).optional(),
}).refine(v => v.mode !== 'payslip' || !!v.pay_month, { message: 'pay_month_required' });

// POST /api/expenses/reimburse - settle approved out-of-pocket claims (admin only).
// Claims that are not approved/personal/unhandled are skipped and reported back.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { ids, mode, paid_date, pay_month, note } = parsed.data;

  const claims = await prisma.expense_claims.findMany({
    where: { id: { in: ids }, status: 'approved', payment_method: 'personal', payslip_id: null },
    select: { id: true, user_id: true, amount: true },
  });
  const total = claims.reduce((s, c) => s + c.amount, 0);

  if (mode === 'payslip') {
    const touched = await prisma.$transaction(tx => attachClaimsToPayslips(tx, claims, pay_month!, actor.id));
    await logAudit({
      actorUserId: actor.id, actionType: 'expense_attach_payslip', targetType: 'expense_claims',
      metadata: { ids: claims.map(c => c.id), total, pay_month, payslips: touched.map(t => t.payslip_id) },
    });
    if (claims.length > 0) void notifyExpenseAddedToPayslip(claims.map(c => c.id), pay_month!);
    return NextResponse.json({ reimbursed: 0, attached: claims.length, skipped: ids.length - claims.length });
  }

  const date = paid_date ?? jstDateString(new Date());
  const res = await prisma.expense_claims.updateMany({
    where: { id: { in: claims.map(c => c.id) }, status: 'approved', payslip_id: null },
    data: { status: 'paid', reimbursed_at: toDbDate(date), reimbursed_by_id: actor.id, reimburse_note: note || null },
  });
  await logAudit({
    actorUserId: actor.id, actionType: 'expense_reimburse', targetType: 'expense_claims',
    metadata: { ids: claims.map(c => c.id), total, users: [...new Set(claims.map(c => c.user_id))] },
  });
  if (res.count > 0) void notifyExpenseReimbursed(claims.map(c => c.id), date, note);
  return NextResponse.json({ reimbursed: res.count, attached: 0, skipped: ids.length - res.count });
}
