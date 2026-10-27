import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';

// GET /api/admin/notification-errors - the latest failed deliveries (system administrators only)
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const rows = await prisma.notification_deliveries.findMany({
    where: { status: 'failed' },
    orderBy: { created_at: 'desc' },
    take: 100,
    relationLoadStrategy: 'join',
    select: { id: true, channel: true, status: true, error_message: true, created_at: true, event: { select: { title: true, priority: true } } },
  });
  return NextResponse.json({ items: rows });
}
