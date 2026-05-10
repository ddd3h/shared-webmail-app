import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MFI_ALERT_THRESHOLD } from '@/lib/mfi';

// GET /api/mfi/alerts — users whose latest MFI snapshot is below threshold
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  // Latest snapshot per user within the last 24 hours, filtered to below threshold
  const snapshots = await prisma.mfi_snapshots.findMany({
    where: {
      mfi: { lt: MFI_ALERT_THRESHOLD },
      recorded_at: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
    },
    orderBy: { recorded_at: 'desc' },
    distinct: ['user_id'],
    select: {
      mfi: true,
      recorded_at: true,
      user: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    threshold: MFI_ALERT_THRESHOLD,
    users: snapshots.map(s => ({
      id: s.user.id,
      name: s.user.name,
      mfi: Math.round(s.mfi * 10) / 10,
      recorded_at: s.recorded_at.toISOString(),
    })),
  });
}
