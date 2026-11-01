import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';
import { accountChangedSinceApproval, vendorFingerprint } from '@/lib/payment-fp';

// POST /api/payments/:id/reconfirm - the payee's bank details changed after this request was approved: an admin looks at the new ones and confirms
// that the request is still to be paid (admin only; never the one who asked for the payment, while another admin exists).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const r = await prisma.payment_requests.findUnique({ where: { id }, include: { vendor: true } });
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (r.status !== 'approved') return NextResponse.json({ error: 'not_approved' }, { status: 409 });
  if (!r.vendor.verified_at || !r.vendor.is_active) return NextResponse.json({ error: 'vendor_unverified' }, { status: 409 });
  if (!accountChangedSinceApproval(r, r.vendor)) return NextResponse.json({ error: 'not_changed' }, { status: 409 });
  if (r.user_id === actor.id && (await prisma.users.count({ where: { role: 'admin' } })) > 1) return NextResponse.json({ error: 'self_approval' }, { status: 403 });
  await prisma.payment_requests.update({ where: { id }, data: { approved_account_fp: vendorFingerprint(r.vendor), reviewed_by_id: actor.id, reviewed_at: new Date() } });
  await logAudit({ actorUserId: actor.id, actionType: 'payment_reconfirm', targetType: 'payment_requests', targetId: id, metadata: { vendor_id: r.vendor_id, last4: r.vendor.account_last4 } });
  return NextResponse.json({ ok: true });
}
