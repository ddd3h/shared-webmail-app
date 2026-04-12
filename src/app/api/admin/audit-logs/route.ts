import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

  const rows = await prisma.audit_logs.findMany({
    where: q
      ? {
          OR: [
            { action_type: { contains: q, mode: 'insensitive' } },
            { target_type: { contains: q, mode: 'insensitive' } },
            { target_id: { contains: q, mode: 'insensitive' } },
            { metadata_json: { contains: q, mode: 'insensitive' } }
          ]
        }
      : undefined,
    orderBy: { created_at: 'desc' },
    take: limit,
    include: {
      actor: { select: { name: true, email: true } }
    }
  });

  return NextResponse.json({ items: rows });
}
