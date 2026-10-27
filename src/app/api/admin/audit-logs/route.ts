import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';

// GET /api/admin/audit-logs?q=&limit=100 - the audit trail, newest first (system administrators only)
export async function GET(req: NextRequest) {
  if (!(await adminActor())) return forbidden();
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);

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
    relationLoadStrategy: 'join', // the row and its actor in one query
    include: {
      actor: { select: { name: true, email: true } }
    }
  });

  return NextResponse.json({ items: rows });
}
