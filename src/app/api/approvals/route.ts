import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin } from '@/lib/work-auth';
import { executiveIds, unitsInScope, usersInScope } from '@/lib/org-server';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/approvals - requests waiting for the caller's decision: everybody's for admins,
// otherwise those of the members of the units they head (when their 役職 allows approving). A 役員's requests are decided by the other 役員 only.
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const admin = isAdmin(actor);
  const execs = await executiveIds();
  const otherExecs = execs.filter(id => id !== actor.id);
  const iAmExec = execs.includes(actor.id);
  // the heads of a 部署 never decide a 役員's request: take the 役員 out of what the 部署 covers, and add the other 役員 for a 役員
  const unitUsers = admin ? [] : (await usersInScope(actor, 'approve_requests')).filter(id => !execs.includes(id));
  const userIds = admin ? null : [...unitUsers, ...(iAmExec ? otherExecs : [])];
  if (userIds && userIds.length === 0) return NextResponse.json({ expenses: [], trips: [], allowed: false });
  const who = userIds ? { user_id: { in: userIds } } : {};
  // an expense claim is decided by the 部署 it was made for; one with no 部署 chosen (older) by anybody who covers the person
  const scope = userIds ? [...(await unitsInScope(actor, 'approve_requests'))] : null;
  const expenseWho = scope ? { OR: [{ unit_id: { in: scope }, user_id: { notIn: execs } }, { unit_id: null, ...who }, ...(iAmExec ? [{ user_id: { in: otherExecs } }] : [])] } : {};

  const [expenses, trips] = await Promise.all([
    prisma.expense_claims.findMany({ where: { status: 'pending', ...expenseWho }, orderBy: { created_at: 'asc' }, take: 200, include: { user: { select: { id: true, name: true } }, unit: { select: { id: true, name: true } }, receipts: { select: { id: true, filename: true }, orderBy: { created_at: 'asc' } } } }),
    prisma.business_trips.findMany({ where: { status: 'pending', ...who }, orderBy: { created_at: 'asc' }, take: 200, include: { user: { select: { id: true, name: true } } } }),
  ]);
  return NextResponse.json({
    allowed: true,
    expenses: expenses.map(c => ({ id: c.id, user: c.user, unit: c.unit, receipts: c.receipts, title: c.title, category: c.category, amount: c.amount, payment_method: c.payment_method, expense_date: ymd(c.expense_date) })),
    trips: trips.map(t => ({ id: t.id, user: t.user, destination: t.destination, purpose: t.purpose, start_date: ymd(t.start_date), end_date: ymd(t.end_date) })),
  });
}
