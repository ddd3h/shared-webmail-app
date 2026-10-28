import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';
import { notifyPaymentReviewed } from '@/lib/work-notify';

const schema = z.object({ action: z.enum(['approve', 'reject']), comment: z.string().trim().max(1000).optional() });

// POST /api/payments/:id/review - approve or reject a pending request (admin only).
// Approval needs a verified payee account; with more than one admin nobody approves their own request.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { action, comment } = parsed.data;
  if (action === 'reject' && !comment) return NextResponse.json({ error: 'comment_required' }, { status: 400 });

  const r = await prisma.payment_requests.findUnique({ where: { id }, include: { vendor: { select: { verified_at: true, is_active: true } } } });
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (r.status !== 'pending') return NextResponse.json({ error: 'not_pending' }, { status: 409 });
  if (action === 'approve' && (!r.vendor.verified_at || !r.vendor.is_active)) return NextResponse.json({ error: 'vendor_unverified' }, { status: 409 });
  if (r.user_id === actor.id && (await prisma.users.count({ where: { role: 'admin' } })) > 1) {
    return NextResponse.json({ error: 'self_approval' }, { status: 403 });
  }
  const res = await prisma.payment_requests.updateMany({
    where: { id, status: 'pending' },
    data: { status: action === 'approve' ? 'approved' : 'rejected', reviewed_by_id: actor.id, reviewed_at: new Date(), review_comment: comment || null },
  });
  if (res.count === 0) return NextResponse.json({ error: 'not_pending' }, { status: 409 });
  await logAudit({ actorUserId: actor.id, actionType: `payment_${action}`, targetType: 'payment_requests', targetId: id, metadata: { user_id: r.user_id, amount: r.amount, vendor_id: r.vendor_id } });
  void notifyPaymentReviewed(id, action);
  return NextResponse.json({ ok: true });
}
