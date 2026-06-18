import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getModelStats } from '@/lib/spam-classifier';

export async function checkAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  requireAuth(session);
  const actor = await prisma.users.findUnique({ where: { id: session!.userId }, select: { role: true } });
  if (actor?.role !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403 });
}

// GET /api/admin/spam-classifier — model stats
export async function GET() {
  const session = await getSession();
  await checkAdmin(session);
  const stats = await getModelStats();
  return NextResponse.json({ stats });
}
