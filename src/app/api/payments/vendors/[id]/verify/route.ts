import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';

// POST /api/payments/vendors/:id/verify - an admin confirms the bank details against the invoice / contract
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const v = await prisma.payment_vendors.findUnique({ where: { id } });
  if (!v) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.payment_vendors.update({ where: { id }, data: { verified_at: new Date(), verified_by_id: actor.id } });
  await logAudit({ actorUserId: actor.id, actionType: 'payment_vendor_verify', targetType: 'payment_vendors', targetId: id, metadata: { name: v.name, last4: v.account_last4 } });
  return NextResponse.json({ ok: true });
}
