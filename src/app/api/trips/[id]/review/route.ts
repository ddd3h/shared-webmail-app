import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor } from '@/lib/work-auth';
import { canReviewUser } from '@/lib/org-server';
import { notifyTripReviewed } from '@/lib/work-notify';

const schema = z.object({ action: z.enum(['approve', 'reject']), comment: z.string().trim().max(1000).optional() });

// POST /api/trips/:id/review - approve or reject a pending request (admins, or the head of the applicant's unit).
// With more than one admin, nobody approves their own request.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { action, comment } = parsed.data;
  if (action === 'reject' && !comment) return NextResponse.json({ error: 'comment_required' }, { status: 400 });

  const trip = await prisma.business_trips.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // admins, or a unit head whose 役職 allows approving the applicant's requests
  if (!(await canReviewUser(actor, trip.user_id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (trip.status !== 'pending') return NextResponse.json({ error: 'not_pending' }, { status: 409 });
  if (trip.user_id === actor.id && (await prisma.users.count({ where: { role: 'admin' } })) > 1) {
    return NextResponse.json({ error: 'self_approval' }, { status: 403 });
  }
  const res = await prisma.business_trips.updateMany({
    where: { id, status: 'pending' },
    data: { status: action === 'approve' ? 'approved' : 'rejected', reviewed_by_id: actor.id, reviewed_at: new Date(), review_comment: comment || null },
  });
  if (res.count === 0) return NextResponse.json({ error: 'not_pending' }, { status: 409 });
  await logAudit({ actorUserId: actor.id, actionType: `trip_${action}`, targetType: 'business_trips', targetId: id, metadata: { user_id: trip.user_id } });
  void notifyTripReviewed(id, action);
  return NextResponse.json({ ok: true });
}
