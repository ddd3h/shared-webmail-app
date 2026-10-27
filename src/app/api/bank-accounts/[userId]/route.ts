import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth, freshLoginRequired } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { last4 } from '@/lib/payment';
import { bankAccountSchema, serializeBankAccount } from '@/lib/bank-account';
import { accountChanged, rowData } from '@/lib/bank-account-server';
import { notifyBankAccountChanged, notifyBankAccountChangedByStaff } from '@/lib/work-notify';

// PUT /api/bank-accounts/:userId - 管理者・経理担当 register or change anybody's receiving account (a person who cannot do it themself, a typo to fix…).
// The account then counts as unchecked, and the person who changed it may not be the one who checks it (see the verify route).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const actor = await financeActor();
  if (!actor) return forbidden();
  const session = await getSession();
  requireAuth(session);
  const stale = freshLoginRequired(session);
  if (stale) return stale;
  const parsed = bankAccountSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', fields: parsed.error.issues.map(i => i.path[0]) }, { status: 400 });
  const d = parsed.data;

  const owner = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
  if (!owner) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const existing = await prisma.user_bank_accounts.findUnique({ where: { user_id: userId } });
  const changed = await accountChanged(existing, d);
  // changing my own account is just that: me, the owner
  const data = await rowData(d, changed, existing, userId === actor.id ? null : actor.id);
  const row = await prisma.user_bank_accounts.upsert({ where: { user_id: userId }, create: { ...data, user_id: userId }, update: data });

  if (changed) {
    await logAudit({ actorUserId: actor.id, actionType: 'bank_account_change', targetType: 'user_bank_accounts', targetId: row.id, metadata: { user_id: userId, by_staff: userId !== actor.id, old_last4: existing?.account_last4 ?? null, new_last4: last4(d.account_number) } });
    if (userId === actor.id) void notifyBankAccountChanged(userId);
    else void notifyBankAccountChangedByStaff(userId, actor.id);
  }
  return NextResponse.json({ account: await serializeBankAccount(row, true), verification_cleared: changed && !!existing?.verified_at });
}

// DELETE /api/bank-accounts/:userId - remove the registered account (it can be registered again). Only the last 4 digits are logged.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const actor = await financeActor();
  if (!actor) return forbidden();
  const session = await getSession();
  requireAuth(session);
  const stale = freshLoginRequired(session);
  if (stale) return stale;
  const existing = await prisma.user_bank_accounts.findUnique({ where: { user_id: userId } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.user_bank_accounts.delete({ where: { user_id: userId } });
  await logAudit({ actorUserId: actor.id, actionType: 'bank_account_delete', targetType: 'user_bank_accounts', targetId: existing.id, metadata: { user_id: userId, last4: existing.account_last4 } });
  if (userId !== actor.id) void notifyBankAccountChangedByStaff(userId, actor.id, true);
  return NextResponse.json({ ok: true });
}
