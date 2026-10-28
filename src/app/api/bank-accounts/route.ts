import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { serializeBankAccount } from '@/lib/bank-account';

// GET /api/bank-accounts - everybody's receiving account and whether it is verified (finance staff only).
// The response contains full account numbers, so each look is logged.
export async function GET() {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const users = await prisma.users.findMany({
    select: { id: true, name: true, worker_type: true, bank_account: true },
    orderBy: { created_at: 'asc' },
  });
  const items = await Promise.all(users.map(async u => ({ user: { id: u.id, name: u.name, worker_type: u.worker_type }, account: await serializeBankAccount(u.bank_account, true) })));
  await logAudit({ actorUserId: actor.id, actionType: 'bank_account_list_view', targetType: 'user_bank_accounts', metadata: { count: items.filter(i => i.account).length } });
  return NextResponse.json({ items });
}
