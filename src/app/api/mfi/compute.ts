import { prisma } from '@/lib/db';
import { MFI_ALERT_THRESHOLD } from '@/lib/mfi';
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

  // 1. Get all unread messages (Personal + Team with permission)
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
    select: { last_message_at: true }
  });

  // Calculate debt breakdown
  let debt = 0;
  let oldestUnreadMs = 0;
  const breakdown = { count_under1h: 0, count_h1_24h: 0, count_d1_3d: 0, count_over3d: 0 };

  const allUnread = [
    ...personalUnread.map(t => ({ last: t.last_message_at })),
    ...teamUnread.map(t => ({ last: t.last_message_at }))
  ];

  for (const t of allUnread) {
    const ageMs = nowMs - t.last.getTime();
    if (ageMs > oldestUnreadMs) oldestUnreadMs = ageMs;

    const ageHours = ageMs / (1000 * 3600);
    if (ageHours <= 1) {
      debt += 0.2;
      breakdown.count_under1h++;
    } else if (ageHours <= 24) {
      debt += 1.0;
      breakdown.count_h1_24h++;
    } else if (ageHours <= 72) {
      debt += 3.0;
      breakdown.count_d1_3d++;
    } else {
      debt += 8.0;
      breakdown.count_over3d++;
    }
  }

  // 2. Personal Baseline (Median of last 30 days)
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 3600 * 1000);
  const snapshots = await prisma.mfi_snapshots.findMany({
    where: { user_id: userId, recorded_at: { gte: thirtyDaysAgo } },
    select: { debt: true },
    orderBy: { recorded_at: 'desc' }
  });

  let baseline = 1.0;
  if (snapshots.length >= 3) {
    const sortedDebts = snapshots.map(s => s.debt).sort((a, b) => a - b);
    baseline = sortedDebts[Math.floor(sortedDebts.length / 2)] || 1.0;
  } else {
    baseline = Math.max(1.0, debt * 2);
  }

  // 3. MFI Score
  const mfi = 100 * Math.exp(-debt / baseline);

  // 4. Streak & Stats
  const lastSnapshot = snapshots[0];
  const athRow = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId },
    orderBy: { price: 'desc' },
    select: { price: true }
  });
  const ath = athRow?.price || 0;

  const yesterday = new Date(nowMs - 24 * 3600 * 1000);
  const snapshot24h = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId, recorded_at: { lte: yesterday } },
    orderBy: { recorded_at: 'desc' },
    select: { mfi: true }
  });
  const change24h = snapshot24h ? mfi - snapshot24h.mfi : 0;

  // Streak hours (approximate from snapshots)
  let streakHours = 0;
  if (lastSnapshot) {
    const latestHealthy = await prisma.mfi_snapshots.findFirst({
      where: { user_id: userId, mfi: { lt: 70 } },
      orderBy: { recorded_at: 'desc' },
      select: { recorded_at: true }
    });
    if (latestHealthy) {
      streakHours = (nowMs - latestHealthy.recorded_at.getTime()) / (1000 * 3600);
    } else {
      const firstSnapshot = await prisma.mfi_snapshots.findFirst({
        where: { user_id: userId },
        orderBy: { recorded_at: 'asc' },
        select: { recorded_at: true }
      });
      if (firstSnapshot) streakHours = (nowMs - firstSnapshot.recorded_at.getTime()) / (1000 * 3600);
    }
  }

  const streakBonus = 1 + Math.min(0.2, streakHours * 0.005);
  const price = mfi * 10 * streakBonus;

  // Repaid today (debt reduction since midnight)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const firstToday = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId, recorded_at: { gte: todayStart } },
    orderBy: { recorded_at: 'asc' },
    select: { debt: true }
  });
  const repaidToday = firstToday ? Math.max(0, firstToday.debt - debt) : 0;

  // Action hint
  let actionHint = null;
  if (breakdown.count_over3d > 0) actionHint = `${breakdown.count_over3d}件の古い未読（3日超）を処理するとMFIが大幅に回復します。`;
  else if (breakdown.count_d1_3d > 0) actionHint = `1〜3日前の未読が${breakdown.count_d1_3d}件あります。早めにチェックしましょう。`;
  else if (debt > 0) actionHint = '順調です。残りの未読も片付けてストリークを伸ばしましょう。';

  return {
    mfi, price, change24h, ath, debt, streak_hours: streakHours,
    oldest_unread_ms: oldestUnreadMs, repaid_today: repaidToday,
    action_hint: actionHint, breakdown
  };
}

export async function computeAndStoreMfi(userId: string): Promise<MfiResult> {
  const data = await computeMfi(userId);
  const lastSnapshot = await prisma.mfi_snapshots.findFirst({
    where: { user_id: userId },
    orderBy: { recorded_at: 'desc' },
    select: { debt: true }
  });

  const volume = lastSnapshot ? Math.max(0, lastSnapshot.debt - data.debt) : 0;

  await prisma.mfi_snapshots.create({
    data: {
      user_id: userId,
      mfi: data.mfi,
      price: data.price,
      debt: data.debt,
      volume: volume,
      streak_hours: data.streak_hours,
      recorded_at: new Date()
    }
  });

  // Send Mattermost DM when MFI drops below threshold (throttled to once per 12h in sendMfiBelowThresholdDm)
  if (data.mfi < MFI_ALERT_THRESHOLD) {
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) {
      sendMfiBelowThresholdDm(userId, user.email, data.mfi).catch(() => {});
    }
  }

  return data;
}
