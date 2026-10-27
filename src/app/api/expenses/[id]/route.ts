import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { deleteStoredFiles } from '@/lib/attachment-storage';
import { isValidDateString, toDbDate } from '@/lib/work';
import { notifyExpenseSubmitted } from '@/lib/work-notify';
import { checkTripLink } from '@/lib/trip-server';
import { EXPENSE_CATEGORIES, MAX_AMOUNT, isEditable } from '@/lib/expense';

const schema = z.object({
  expense_date: z.string().refine(isValidDateString),
  category: z.enum(EXPENSE_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(MAX_AMOUNT),
  payment_method: z.enum(['personal', 'company']),
  description: z.string().trim().max(2000).nullable().optional(),
  // undefined = leave as is, null = detach from the trip
  trip_id: z.string().min(1).nullable().optional(),
});

// PATCH /api/expenses/:id - the claimant edits a pending or rejected claim.
// Editing a rejected claim resubmits it for approval.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const claim = await prisma.expense_claims.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (claim.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!isEditable(claim)) return NextResponse.json({ error: 'not_editable' }, { status: 409 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  if (d.trip_id && d.trip_id !== claim.trip_id && !(await checkTripLink(session.userId, d.trip_id))) {
    return NextResponse.json({ error: 'invalid_trip' }, { status: 400 });
  }
  await prisma.expense_claims.update({
    where: { id },
    data: {
      expense_date: toDbDate(d.expense_date), category: d.category, title: d.title, amount: d.amount,
      payment_method: d.payment_method, description: d.description || null,
      ...(d.trip_id !== undefined ? { trip_id: d.trip_id } : {}),
      status: 'pending', reviewed_by_id: null, reviewed_at: null, review_comment: null,
    },
  });
  if (claim.status === 'rejected') void notifyExpenseSubmitted(id, true);
  return NextResponse.json({ ok: true });
}

// DELETE /api/expenses/:id - the claimant withdraws a pending/rejected claim; admins can delete any unpaid one.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  const claim = await prisma.expense_claims.findUnique({ where: { id }, include: { receipts: true } });
  if (!actor || !claim) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const own = claim.user_id === actor.id;
  if (!own && !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  // Paid claims are the record of a payment; approved ones only an admin may remove.
  if (claim.status === 'paid' || (own && !isEditable(claim))) return NextResponse.json({ error: 'not_deletable' }, { status: 409 });
  await prisma.expense_claims.delete({ where: { id } });
  await deleteStoredFiles(claim.receipts.map(r => r.storage_key));
  return NextResponse.json({ ok: true });
}
