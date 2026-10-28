import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { notifyBankAccountVerified } from '@/lib/work-notify';

const schema = z.object({ revision: z.string().min(1) });

/** Nobody confirms their own account, or one they changed themself, while another finance person exists. */
async function mayVerifyOwn(actorId: string): Promise<boolean> {
  const others = await prisma.users.count({ where: { id: { not: actorId }, OR: [{ role: 'admin' }, { is_accounting: true }] } });
  return others === 0;
}

// POST /api/bank-accounts/:userId/verify - finance staff confirm the account against the person's own documents.
// The body names the `revision` they looked at. If the owner changed the account in the meantime the revision no longer
// matches and nothing is confirmed, so a swapped account can't be approved by mistake.
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const actor = await financeActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const acct = await prisma.user_bank_accounts.findUnique({ where: { user_id: userId } });
  if (!acct) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (userId === actor.id && !(await mayVerifyOwn(actor.id))) return NextResponse.json({ error: 'self_verify' }, { status: 403 });
  if (acct.changed_by_id === actor.id && userId !== actor.id && !(await mayVerifyOwn(actor.id))) return NextResponse.json({ error: 'self_verify_change' }, { status: 403 });

  const seen = new Date(parsed.data.revision);
  const done = await prisma.user_bank_accounts.updateMany({
    where: { user_id: userId, updated_at: Number.isNaN(seen.getTime()) ? new Date(0) : seen },
    data: { verified_at: new Date(), verified_by_id: actor.id },
  });
  if (done.count === 0) return NextResponse.json({ error: 'changed', message: '口座が変更されました。内容を確認し直してください' }, { status: 409 });

  await logAudit({ actorUserId: actor.id, actionType: 'bank_account_verify', targetType: 'user_bank_accounts', targetId: acct.id, metadata: { user_id: userId, last4: acct.account_last4 } });
  void notifyBankAccountVerified(userId);
  return NextResponse.json({ ok: true });
}
