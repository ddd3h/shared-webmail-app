import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MFI_ALERT_THRESHOLD } from '@/lib/mfi';

// GET /api/mfi/alerts — users whose latest MFI snapshot is below threshold
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  // Split into two queries to avoid Prisma distinct+relation select ambiguity.
  // Step 1: get latest snapshot per user (no relation join → DISTINCT ON works cleanly).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const latestSnaps = await prisma.mfi_snapshots.findMany({
    where: { recorded_at: { gte: sevenDaysAgo } },
    orderBy: { recorded_at: 'desc' },
    distinct: ['user_id'],
    select: { user_id: true, mfi: true, recorded_at: true },
  });

  // Step 2: filter below threshold, then fetch user names.
  const alertSnaps = latestSnaps.filter(s => s.mfi < MFI_ALERT_THRESHOLD);
  if (alertSnaps.length === 0) {
    return NextResponse.json({ threshold: MFI_ALERT_THRESHOLD, users: [] });
  }

  const users = await prisma.users.findMany({
    where: { id: { in: alertSnaps.map(s => s.user_id) } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map(u => [u.id, u]));

  return NextResponse.json({
    threshold: MFI_ALERT_THRESHOLD,
    users: alertSnaps
      .map(s => {
        const u = userMap.get(s.user_id);
        if (!u) return null;
        return {
          id: u.id,
          name: u.name,
          mfi: Math.round(s.mfi * 10) / 10,
          recorded_at: s.recorded_at.toISOString(),
        };
      })
      .filter(Boolean),
  });
}
