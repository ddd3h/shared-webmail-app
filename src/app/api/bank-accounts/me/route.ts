import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth, freshLoginRequired } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { last4 } from '@/lib/payment';
import { bankAccountSchema, serializeBankAccount } from '@/lib/bank-account';
import { accountChanged, rowData } from '@/lib/bank-account-server';
import { notifyBankAccountChanged } from '@/lib/work-notify';

// GET /api/bank-accounts/me - my own receiving account (salary, reimbursements)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const row = await prisma.user_bank_accounts.findUnique({ where: { user_id: session.userId } });
  return NextResponse.json({ account: await serializeBankAccount(row, true) });
}

// PUT /api/bank-accounts/me - register or change my account.
export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const stale = freshLoginRequired(session);
  if (stale) return stale;
  const parsed = bankAccountSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', fields: parsed.error.issues.map(i => i.path[0]) }, { status: 400 });
  const d = parsed.data;

  const existing = await prisma.user_bank_accounts.findUnique({ where: { user_id: session.userId } });
  const changed = await accountChanged(existing, d);
  const data = await rowData(d, changed, existing);
  const row = await prisma.user_bank_accounts.upsert({ where: { user_id: session.userId }, create: { ...data, user_id: session.userId }, update: data });

  if (changed) {
    // only the last 4 digits ever go into the log
    await logAudit({ actorUserId: session.userId, actionType: 'bank_account_change', targetType: 'user_bank_accounts', targetId: row.id, metadata: { old_last4: existing?.account_last4 ?? null, new_last4: last4(d.account_number) } });
    void notifyBankAccountChanged(session.userId);
  }
  return NextResponse.json({ account: await serializeBankAccount(row, true), verification_cleared: changed && !!existing?.verified_at });
}
