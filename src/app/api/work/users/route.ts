import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin } from '@/lib/work-auth';

// GET /api/work/users - everyone with their worker type (admin only)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const items = await prisma.users.findMany({
    select: { id: true, name: true, email: true, role: true, worker_type: true, is_accounting: true },
    orderBy: { created_at: 'asc' },
  });
  return NextResponse.json({ items });
}
