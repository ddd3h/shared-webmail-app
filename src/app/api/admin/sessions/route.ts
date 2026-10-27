import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';

// GET /api/admin/sessions - who is logged in right now (newest first; at most 300)
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const rows = await prisma.sessions.findMany({
    where: { expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
    take: 300,
    select: {
      id: true, ip_address: true, user_agent: true, network_type: true, expires_at: true, last_activity_at: true, created_at: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  return NextResponse.json({ items: rows });
}
