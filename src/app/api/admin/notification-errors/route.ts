import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const rows = await prisma.notification_deliveries.findMany({
    where: { status: 'failed' },
    orderBy: { created_at: 'desc' },
    take: 100,
    include: { event: true }
  });
  return NextResponse.json({ items: rows });
}

