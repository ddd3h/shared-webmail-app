import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { serializeLogin } from '@/lib/security-view';

// GET /api/admin/login-logs?q=&failed=1&limit=50&before=<ISO>
// Newest first, a page at a time (`next` is the `before` of the next page). Only the columns the screen shows are read.
export async function GET(req: NextRequest) {
  if (!(await adminActor())) return forbidden();
  const sp = new URL(req.url).searchParams;
  const q = (sp.get('q') || '').trim().slice(0, 100);
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 200);
  const before = sp.get('before') ? new Date(sp.get('before')!) : null;
  if (before && isNaN(before.getTime())) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });

  const where: Prisma.login_logsWhereInput = {
    ...(sp.get('failed') === '1' ? { success: false } : {}),
    ...(before ? { created_at: { lt: before } } : {}),
    ...(q ? { OR: ['email', 'ip_address', 'org_name', 'city', 'country'].map(f => ({ [f]: { contains: q, mode: 'insensitive' as const } })) } : {}),
  };
  const rows = await prisma.login_logs.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true, success: true, failure_reason: true, ip_address: true, user_agent: true, network_type: true, org_name: true, country: true, city: true, created_at: true, email: true,
      user: { select: { name: true } },
    },
  });
  const page = rows.slice(0, limit);
  return NextResponse.json({
    items: page.map(l => ({ ...serializeLogin(l), email: l.email, name: l.user?.name ?? null })),
    next: rows.length > limit ? page[page.length - 1].created_at : null,
  });
}
