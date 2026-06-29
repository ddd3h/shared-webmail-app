import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

  const rows = await prisma.login_logs.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { ip_address: { contains: q, mode: 'insensitive' } },
            { org_name: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            { country: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { created_at: 'desc' },
    take: limit,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({ items: rows });
}
