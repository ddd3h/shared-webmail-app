// Shared MFI computation used by both /api/mfi/current and the cron job
import { prisma } from '@/lib/db';
import {
  computeDebt, computeBaseline, computeMFI, computeStreakHours,
  computeStreakBonus, buildActionHint, shouldCreateSnapshot,
  MFI_ALERT_THRESHOLD,
} from '@/lib/mfi';
import { sendMfiBelowThresholdDm } from '@/lib/mattermost-dm';

export async function computeAndStoreMfi(userId: string, email: string) {
  // Fetch unread threads the user can access
  const threads = await prisma.threads.findMany({
    where: {
      unread_count: { gt: 0 },
      is_archived: false,
      mailbox: {
        OR: [
          { type: 'personal', owner_user_id: userId },
          { permissions: { some: { user_id: userId, can_view: true } } },
        ],
      },
    },
    select: { unread_count: true, last_message_at: true },
  });

  const breakdown = computeDebt(threads);

  // Baseline: median of last 30 days of snapshots (or current debt if no history)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const history = await prisma.mfi_snapshots.findMany({
    where: { user_id: userId, recorded_at: { gte: thirtyDaysAgo } },
    select: { debt: true, recorded_at: true },
    orderBy: { recorded_at: 'desc' },
  });

  // Bootstrap: when history is sparse, use 2× current debt as baseline so
  // MFI starts at exp(-0.5)×100 ≈ 60 rather than the misleading exp(-1)×100 ≈ 37
  const baseline = history.length >= 3
    ? computeBaseline(history.map(s => s.debt))
    : Math.max(1, breakdown.total * 2);

  const mfi = computeMFI(breakdown.total, baseline);
  const streakHours = computeStreakHours(history, baseline);
  const streakBonus = computeStreakBonus(streakHours);
  const price = mfi * 10 * streakBonus;

  // Volume = debt reduction since last snapshot
  const lastSnapshot = history[0] ?? null;
  const volume = lastSnapshot
    ? Math.max(0, lastSnapshot.debt - breakdown.total)
    : 0;

  // Store snapshot (max one per 5 minutes)
  if (shouldCreateSnapshot(lastSnapshot?.recorded_at ?? null)) {
    await prisma.mfi_snapshots.create({
      data: { user_id: userId, mfi, price, debt: breakdown.total, volume, streak_hours: streakHours },
    });

    // Send Mattermost DM if MFI has dropped below threshold
    if (mfi < MFI_ALERT_THRESHOLD) {
      sendMfiBelowThresholdDm(userId, email, mfi).catch(() => {});
    }
  }

  // ATH from all snapshots
  const ath = await prisma.mfi_snapshots.aggregate({
    where: { user_id: userId },
    _max: { price: true },
  });

  // 24h change
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const dayAgoSnap = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId, recorded_at: { lte: oneDayAgo } },
    orderBy: { recorded_at: 'desc' },
    select: { price: true },
  });
  const change24h = dayAgoSnap
    ? ((price - dayAgoSnap.price) / Math.max(1, dayAgoSnap.price)) * 100
    : 0;

  // Repaid today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todaySnaps = await prisma.mfi_snapshots.aggregate({
    where: { user_id: userId, recorded_at: { gte: startOfDay } },
    _sum: { volume: true },
  });
  const repaidToday = todaySnaps._sum.volume ?? 0;

  const oldestUnreadMs = breakdown.oldest_ms;
  const actionHint = buildActionHint(breakdown, baseline);

  return {
    mfi: Math.round(mfi * 10) / 10,
    price: Math.round(price * 100) / 100,
    change24h: Math.round(change24h * 10) / 10,
    ath: Math.round((ath._max.price ?? price) * 100) / 100,
    debt: Math.round(breakdown.total * 10) / 10,
    streak_hours: streakHours,
    oldest_unread_ms: oldestUnreadMs,
    repaid_today: Math.round(repaidToday * 10) / 10,
    action_hint: actionHint,
    breakdown: {
      count_under1h: breakdown.count_under1h,
      count_h1_24h: breakdown.count_h1_24h,
      count_d1_3d: breakdown.count_d1_3d,
      count_over3d: breakdown.count_over3d,
    },
  };
}
