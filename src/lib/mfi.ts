// Mail Freshness Index (MFI) — core calculation library
// Uses threads.unread_count as a proxy for unread message count,
// and threads.last_message_at as a proxy for message age.

export const DEBT_WEIGHTS = {
  under1h: 0.2,
  h1_24h: 1.0,
  d1_3d: 3.0,
  over3d: 8.0,
} as const;

export const MFI_ALERT_THRESHOLD = 50; // Send DM when MFI drops below this
const HEALTHY_RATIO = 0.5; // "healthy" = debt < 50% of baseline
const SNAPSHOT_INTERVAL_MS = 4 * 3600 * 1000; // Max one snapshot per 4 hours

export type DebtBreakdown = {
  total: number;
  under1h: number;
  h1_24h: number;
  d1_3d: number;
  over3d: number;
  count_under1h: number;
  count_h1_24h: number;
  count_d1_3d: number;
  count_over3d: number;
  oldest_ms: number; // age of oldest unread in ms, 0 if none
};

export function computeDebt(
  threads: { unread_count: number; last_message_at: Date }[]
): DebtBreakdown {
  const now = Date.now();
  let total = 0;
  let count_under1h = 0, count_h1_24h = 0, count_d1_3d = 0, count_over3d = 0;
  let oldest_ms = 0;

  for (const t of threads) {
    if (t.unread_count <= 0) continue;
    const ageMs = now - t.last_message_at.getTime();
    const ageH = ageMs / 3600000;
    if (ageMs > oldest_ms) oldest_ms = ageMs;

    const count = t.unread_count;
    if (ageH < 1) {
      count_under1h += count;
      total += count * DEBT_WEIGHTS.under1h;
    } else if (ageH < 24) {
      count_h1_24h += count;
      total += count * DEBT_WEIGHTS.h1_24h;
    } else if (ageH < 72) {
      count_d1_3d += count;
      total += count * DEBT_WEIGHTS.d1_3d;
    } else {
      count_over3d += count;
      total += count * DEBT_WEIGHTS.over3d;
    }
  }

  return {
    total,
    under1h: count_under1h * DEBT_WEIGHTS.under1h,
    h1_24h: count_h1_24h * DEBT_WEIGHTS.h1_24h,
    d1_3d: count_d1_3d * DEBT_WEIGHTS.d1_3d,
    over3d: count_over3d * DEBT_WEIGHTS.over3d,
    count_under1h, count_h1_24h, count_d1_3d, count_over3d,
    oldest_ms,
  };
}

export function computeBaseline(debts: number[]): number {
  if (debts.length === 0) return 1;
  const sorted = [...debts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Scale factor: softens the curve so that debt ≈ baseline gives MFI ≈ 75 (良好)
// rather than 36.8. MFI 60 corresponds to ~1.7× baseline (slightly worse than normal).
const MFI_SCALE = 3.5;

export function computeMFI(debt: number, baseline: number): number {
  return 100 * Math.exp(-debt / Math.max(1, baseline * MFI_SCALE));
}

export function computeStreakHours(
  snapshots: { debt: number; recorded_at: Date }[],
  baseline: number
): number {
  const threshold = baseline * HEALTHY_RATIO;
  const sorted = [...snapshots].sort(
    (a, b) => b.recorded_at.getTime() - a.recorded_at.getTime()
  );
  // Use actual time gaps between snapshots (handles both old 5-min and new 4-hour data).
  // Cap each gap at 2× the current interval to avoid counting server-downtime as streak.
  let totalMs = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].debt >= threshold) break;
    const gapMs = i === 0
      ? SNAPSHOT_INTERVAL_MS
      : sorted[i - 1].recorded_at.getTime() - sorted[i].recorded_at.getTime();
    totalMs += Math.min(gapMs, SNAPSHOT_INTERVAL_MS * 2);
  }
  return Math.round(totalMs / 3600000 * 10) / 10;
}

export function computeStreakBonus(streakHours: number): number {
  return 1 + Math.min(0.2, streakHours * 0.005);
}

export function buildActionHint(
  breakdown: DebtBreakdown,
  baseline: number
): string | null {
  const { count_over3d, count_d1_3d, count_h1_24h, total } = breakdown;

  if (count_over3d > 0) {
    const hypothetical = total - count_over3d * DEBT_WEIGHTS.over3d;
    const gain = computeMFI(hypothetical, baseline) - computeMFI(total, baseline);
    return `${count_over3d}件の3日以上前の未読を処理すると +${(gain * 10).toFixed(1)} 上昇見込み`;
  }
  if (count_d1_3d > 0) {
    return `1〜3日前の未読が${count_d1_3d}件あります。処理して価格を上げましょう`;
  }
  if (count_h1_24h > 0) {
    return `未読${count_h1_24h}件を処理するとさらに改善できます`;
  }
  return null;
}

export function shouldCreateSnapshot(lastRecordedAt: Date | null): boolean {
  if (!lastRecordedAt) return true;
  return Date.now() - lastRecordedAt.getTime() >= SNAPSHOT_INTERVAL_MS;
}
