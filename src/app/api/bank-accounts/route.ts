import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { serializeBankAccount } from '@/lib/bank-account';

// GET /api/bank-accounts - everybody's receiving account and whether it is verified (finance staff only)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const users = await prisma.users.findMany({
    select: { id: true, name: true, worker_type: true, bank_account: true },
    orderBy: { created_at: 'asc' },
  });
  const items = await Promise.all(users.map(async u => ({ user: { id: u.id, name: u.name, worker_type: u.worker_type }, account: await serializeBankAccount(u.bank_account, true) })));
  return NextResponse.json({ items });
}
