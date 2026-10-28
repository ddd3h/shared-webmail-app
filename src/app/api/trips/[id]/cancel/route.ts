import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';

// POST /api/trips/:id/cancel - call off an approved trip (the applicant or an admin).
// Expenses already linked to it stay linked.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  const trip = await prisma.business_trips.findUnique({ where: { id } });
  if (!actor || !trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (trip.user_id !== actor.id && !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const res = await prisma.business_trips.updateMany({ where: { id, status: 'approved' }, data: { status: 'cancelled', cancelled_at: new Date() } });
  if (res.count === 0) return NextResponse.json({ error: 'not_approved' }, { status: 409 });
  await logAudit({ actorUserId: actor.id, actionType: 'trip_cancel', targetType: 'business_trips', targetId: id, metadata: { user_id: trip.user_id } });
  return NextResponse.json({ ok: true });
}
