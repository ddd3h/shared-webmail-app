import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin } from '@/lib/work-auth';
import { usersInScope } from '@/lib/org-server';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/approvals - requests waiting for the caller's decision: everybody's for admins,
// otherwise those of the members of the units they head (when their 役職 allows approving).
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userIds = isAdmin(actor) ? null : await usersInScope(actor, 'approve_requests');
  if (userIds && userIds.length === 0) return NextResponse.json({ expenses: [], trips: [], allowed: false });
  const who = userIds ? { user_id: { in: userIds } } : {};

  const [expenses, trips] = await Promise.all([
    prisma.expense_claims.findMany({ where: { status: 'pending', ...who }, orderBy: { created_at: 'asc' }, take: 200, include: { user: { select: { id: true, name: true } } } }),
    prisma.business_trips.findMany({ where: { status: 'pending', ...who }, orderBy: { created_at: 'asc' }, take: 200, include: { user: { select: { id: true, name: true } } } }),
  ]);
  return NextResponse.json({
    allowed: true,
    expenses: expenses.map(c => ({ id: c.id, user: c.user, title: c.title, category: c.category, amount: c.amount, payment_method: c.payment_method, expense_date: ymd(c.expense_date) })),
    trips: trips.map(t => ({ id: t.id, user: t.user, destination: t.destination, purpose: t.purpose, start_date: ymd(t.start_date), end_date: ymd(t.end_date) })),
  });
}
