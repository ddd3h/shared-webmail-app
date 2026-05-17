/**
 * Recalculate historical MFI snapshots using the updated formula:
 *   MFI = 100 * exp(-debt / (baseline * 3.5))
 *   streak_hours = contiguous time where debt < baseline * 0.5
 *
 * Baseline floor (matches compute.ts):
 *   max(median_of_history, max_recent_debt * 0.20, 10)
 *   Prevents catastrophic MFI drops when the user maintained near-zero debt
 *   and baseline collapsed to ~0.
 *
 * Note: stored `debt` values are not changed — continuous weighting only
 * affects new snapshots going forward.
 *
 * Idempotent: debt/recorded_at unchanged → same result on every run.
 * Run: node prisma/recalculate-mfi.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MFI_SCALE = 3.5;
const HEALTHY_RATIO = 0.5;
const SNAPSHOT_INTERVAL_MS = 4 * 3600 * 1000; // 4 hours
const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function computeMFI(debt, baseline) {
  return 100 * Math.exp(-debt / Math.max(1, baseline * MFI_SCALE));
}

/**
 * Mirrors mfi.ts computeStreakHours exactly.
 * snapshots = all snapshots in the 30-day window up to (and including) current.
 * baseline  = baseline computed at the time of the current snapshot.
 */
function computeStreakHours(snapshots, baseline) {
  const threshold = baseline * HEALTHY_RATIO;
  const sorted = [...snapshots].sort(
    (a, b) => b.recorded_at.getTime() - a.recorded_at.getTime()
  );
  let totalMs = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].debt >= threshold) break;
    const gapMs =
      i === 0
        ? SNAPSHOT_INTERVAL_MS
        : sorted[i - 1].recorded_at.getTime() - sorted[i].recorded_at.getTime();
    totalMs += Math.min(gapMs, SNAPSHOT_INTERVAL_MS * 2);
  }
  return Math.round((totalMs / 3600000) * 10) / 10;
}

function computeStreakBonus(streakHours) {
  return 1 + Math.min(0.2, streakHours * 0.005);
}

async function main() {
  const users = await prisma.mfi_snapshots.findMany({
    select: { user_id: true },
    distinct: ['user_id'],
  });

  console.log(`対象ユーザー数: ${users.length}`);

  let totalUpdated = 0;

  for (const { user_id } of users) {
    const snapshots = await prisma.mfi_snapshots.findMany({
      where: { user_id },
      orderBy: { recorded_at: 'asc' },
    });

    console.log(`  ユーザー ${user_id}: ${snapshots.length} 件を再計算中...`);

    const updates = [];

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const snapTime = snap.recorded_at.getTime();
      const cutoff = new Date(snapTime - THIRTY_DAYS_MS);

      // Baseline = median of debts in the 30 days strictly before this snapshot
      const historicalDebts = snapshots
        .filter(s => s.recorded_at >= cutoff && s.recorded_at < snap.recorded_at)
        .map(s => s.debt);

      const rawBaseline =
        historicalDebts.length >= 3
          ? median(historicalDebts)
          : snap.debt * 2; // bootstrap
      const maxRecentDebt = historicalDebts.length > 0 ? Math.max(...historicalDebts) : 0;
      const baseline = Math.max(rawBaseline, maxRecentDebt * 0.20, 10);

      const newMfi = computeMFI(snap.debt, baseline);

      // Streak: snapshots in 30-day window up to and including this snapshot
      const windowSnaps = snapshots.filter(
        s => s.recorded_at >= cutoff && s.recorded_at <= snap.recorded_at
      );
      const newStreakHours = computeStreakHours(windowSnaps, baseline);
      const newPrice = newMfi * 10 * computeStreakBonus(newStreakHours);

      updates.push(
        prisma.mfi_snapshots.update({
          where: { id: snap.id },
          data: { mfi: newMfi, streak_hours: newStreakHours, price: newPrice },
        })
      );
    }

    await Promise.all(updates);
    totalUpdated += snapshots.length;
    console.log(`  ユーザー ${user_id}: 完了`);
  }

  console.log(`\n再計算完了。合計 ${totalUpdated} 件を更新しました。`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
