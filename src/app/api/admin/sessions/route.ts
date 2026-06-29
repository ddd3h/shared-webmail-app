import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  requireAuth(session);
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const rows = await prisma.sessions.findMany({
    where: { expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ items: rows });
}
