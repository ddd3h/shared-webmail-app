import { prisma } from '@/lib/db';
import {
  MFI_ALERT_THRESHOLD,
  computeDebt,
  computeBaseline,
  computeMFI,
  computeStreakHours,
  computeStreakBonus,
  buildActionHint,
  shouldCreateSnapshot,
} from '@/lib/mfi';
import { sendMfiBelowThresholdDm } from '@/lib/mattermost-dm';

export type MfiResult = {
  mfi: number;
  price: number;
  change24h: number;
  ath: number;
  debt: number;
  streak_hours: number;
  oldest_unread_ms: number;
  repaid_today: number;
  action_hint: string | null;
  breakdown: {
    count_under1h: number;
    count_h1_24h: number;
    count_d1_3d: number;
    count_over3d: number;
  };
};

export async function computeMfi(userId: string): Promise<MfiResult> {
  const now = new Date();
  const nowMs = now.getTime();

  // 1. Get all unread threads
  const personalUnread = await prisma.threads.findMany({
    where: {
      unread_count: { gt: 0 },
      mailbox: { type: 'personal', owner_user_id: userId },
    },
    select: { last_message_at: true, unread_count: true }
  });

  const teamUnread = await prisma.threads.findMany({
    where: {
      mailbox: { type: 'team', permissions: { some: { user_id: userId, can_view: true } } },
      reads: { none: { user_id: userId } }
    },
    select: { last_message_at: true, unread_count: true }
  });

  // 2. Debt breakdown via library (weight × unread_count per thread)
  const breakdown = computeDebt([...personalUnread, ...teamUnread]);
  const debt = breakdown.total;

  // 3. Personal Baseline — median of last 30 days, bootstrap when < 3 snapshots
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 3600 * 1000);
  const snapshots = await prisma.mfi_snapshots.findMany({
    where: { user_id: userId, recorded_at: { gte: thirtyDaysAgo } },
    select: { debt: true, recorded_at: true },
    orderBy: { recorded_at: 'desc' }
  });

  const baseline = snapshots.length >= 3
    ? Math.max(1, computeBaseline(snapshots.map(s => s.debt)))
    : Math.max(1, debt * 2);

  // 4. MFI = 100 × exp(−debt / (baseline × 3.5))
  const mfi = computeMFI(debt, baseline);

  // 5. Streak & Price
  const streakHours = computeStreakHours(snapshots, baseline);
  const streakBonus = computeStreakBonus(streakHours);
  const price = mfi * 10 * streakBonus;

  // 6. ATH
  const athRow = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId },
    orderBy: { price: 'desc' },
    select: { price: true }
  });
  const ath = athRow?.price ?? 0;

  // 7. 24h change
  const yesterday = new Date(nowMs - 24 * 3600 * 1000);
  const snapshot24h = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId, recorded_at: { lte: yesterday } },
    orderBy: { recorded_at: 'desc' },
    select: { mfi: true }
  });
  const change24h = snapshot24h ? mfi - snapshot24h.mfi : 0;

  // 8. Repaid today (debt reduction since midnight)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const firstToday = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId, recorded_at: { gte: todayStart } },
    orderBy: { recorded_at: 'asc' },
    select: { debt: true }
  });
  const repaidToday = firstToday ? Math.max(0, firstToday.debt - debt) : 0;

  return {
    mfi,
    price,
    change24h,
    ath,
    debt,
    streak_hours: streakHours,
    oldest_unread_ms: breakdown.oldest_ms,
    repaid_today: repaidToday,
    action_hint: buildActionHint(breakdown, baseline),
    breakdown: {
      count_under1h: breakdown.count_under1h,
      count_h1_24h: breakdown.count_h1_24h,
      count_d1_3d: breakdown.count_d1_3d,
      count_over3d: breakdown.count_over3d,
    },
  };
}

export async function computeAndStoreMfi(userId: string): Promise<MfiResult> {
  const data = await computeMfi(userId);

  const lastSnapshot = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId },
    orderBy: { recorded_at: 'desc' },
    select: { debt: true, recorded_at: true }
  });

  // Rate-limit snapshot writes to once per 4 hours
  if (!shouldCreateSnapshot(lastSnapshot?.recorded_at ?? null)) {
    return data;
  }

  const volume = lastSnapshot ? Math.max(0, lastSnapshot.debt - data.debt) : 0;

  await prisma.mfi_snapshots.create({
    data: {
      user_id: userId,
      mfi: data.mfi,
      price: data.price,
      debt: data.debt,
      volume,
      streak_hours: data.streak_hours,
      recorded_at: new Date()
    }
  });

  if (data.mfi < MFI_ALERT_THRESHOLD) {
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) {
      sendMfiBelowThresholdDm(userId, user.email, data.mfi).catch(() => {});
    }
  }

  return data;
}
