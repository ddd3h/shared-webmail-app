/**
 * Recalculate historical MFI snapshots using the updated formula:
 *   MFI = 100 * exp(-debt / (baseline * 3.5))
 *
 * Run: node prisma/recalculate-mfi.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MFI_SCALE = 3.5;
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
      const cutoff = new Date(snap.recorded_at.getTime() - THIRTY_DAYS_MS);

      // Baseline = median of debts in the 30 days BEFORE this snapshot
      const historicalDebts = snapshots
        .filter(s => s.recorded_at >= cutoff && s.recorded_at < snap.recorded_at)
        .map(s => s.debt);

      const baseline = historicalDebts.length >= 3
        ? Math.max(1, median(historicalDebts))
        : Math.max(1, snap.debt * 2); // bootstrap: same as computeMfi() logic

      const newMfi = computeMFI(snap.debt, baseline);
      const newPrice = newMfi * 10 * computeStreakBonus(snap.streak_hours);

      updates.push(
        prisma.mfi_snapshots.update({
          where: { id: snap.id },
          data: { mfi: newMfi, price: newPrice },
        })
      );
    }

    // Batch per user
    await Promise.all(updates);
    totalUpdated += snapshots.length;
    console.log(`  ユーザー ${user_id}: 完了`);
  }

  console.log(`\n再計算完了。合計 ${totalUpdated} 件を更新しました。`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
