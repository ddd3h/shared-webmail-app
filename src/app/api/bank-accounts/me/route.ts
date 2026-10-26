import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth, freshLoginRequired } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { decrypt, encrypt } from '@/lib/crypto';
import { last4 } from '@/lib/payment';
import { bankAccountSchema, serializeBankAccount } from '@/lib/bank-account';
import { notifyBankAccountChanged } from '@/lib/work-notify';

type Input = ReturnType<typeof bankAccountSchema.parse>;
type Saved = { bank_name: string; bank_code: string; branch_name: string; branch_code: string; account_type: string; account_holder: string; account_number_enc: string; verified_at: Date | null };

/** True when anything that decides where money goes differs from what is stored. */
async function accountChanged(existing: Saved | null, d: Input): Promise<boolean> {
  if (!existing) return true;
  const sameFields =
    existing.bank_name === d.bank_name && existing.bank_code === d.bank_code && existing.branch_name === d.branch_name &&
    existing.branch_code === d.branch_code && existing.account_type === d.account_type && existing.account_holder === d.account_holder;
  return !sameFields || (await decrypt(existing.account_number_enc).catch(() => '')) !== d.account_number;
}

async function rowData(d: Input, changed: boolean, existing: Saved | null) {
  return {
    bank_name: d.bank_name, bank_code: d.bank_code, branch_name: d.branch_name, branch_code: d.branch_code, account_type: d.account_type,
    account_number_enc: changed ? await encrypt(d.account_number) : existing!.account_number_enc, account_last4: last4(d.account_number),
    account_holder: d.account_holder,
    // any change must be checked by finance again before money is sent to it
    ...(changed ? { verified_at: null, verified_by_id: null } : {}),
  };
}

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
