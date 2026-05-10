import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MFI_ALERT_THRESHOLD } from '@/lib/mfi';

// GET /api/mfi/alerts — users whose latest MFI snapshot is below threshold
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  // Most recent snapshot per user (within 7 days), then filter below threshold in memory.
  // Filtering by mfi in WHERE before DISTINCT would select the "most recent snapshot below
  // threshold" rather than "whether the most recent snapshot is below threshold".
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const latestSnapshots = await prisma.mfi_snapshots.findMany({
    where: {
      recorded_at: { gte: sevenDaysAgo },
    },
    orderBy: { recorded_at: 'desc' },
    distinct: ['user_id'],
    select: {
      mfi: true,
      recorded_at: true,
      user: { select: { id: true, name: true } },
    },
  });

  const alertUsers = latestSnapshots.filter(s => s.mfi < MFI_ALERT_THRESHOLD);

  return NextResponse.json({
    threshold: MFI_ALERT_THRESHOLD,
    users: alertUsers.map(s => ({
      id: s.user.id,
      name: s.user.name,
      mfi: Math.round(s.mfi * 10) / 10,
      recorded_at: s.recorded_at.toISOString(),
    })),
  });
}
