import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { notifyBankAccountVerified } from '@/lib/work-notify';

// POST /api/bank-accounts/:userId/verify - finance staff confirm the account against the person's own documents.
// Nobody confirms their own account while another finance person exists.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const acct = await prisma.user_bank_accounts.findUnique({ where: { user_id: userId } });
  if (!acct) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (userId === actor.id) {
    const others = await prisma.users.count({ where: { id: { not: actor.id }, OR: [{ role: 'admin' }, { is_accounting: true }] } });
    if (others > 0) return NextResponse.json({ error: 'self_verify' }, { status: 403 });
  }
  await prisma.user_bank_accounts.update({ where: { user_id: userId }, data: { verified_at: new Date(), verified_by_id: actor.id } });
  await logAudit({ actorUserId: actor.id, actionType: 'bank_account_verify', targetType: 'user_bank_accounts', targetId: acct.id, metadata: { user_id: userId, last4: acct.account_last4 } });
  void notifyBankAccountVerified(userId);
  return NextResponse.json({ ok: true });
}
