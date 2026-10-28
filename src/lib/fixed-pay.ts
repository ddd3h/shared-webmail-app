// 役員報酬・準業務委託の「固定の月額」(fixed_pay_plans) から、毎月の給与明細の下書きを作るための、DB を使わない部分。
import { addMonths, closingDate, periodOf, type PaySchedule } from '@/lib/pay-schedule';
import type { WorkerType } from '@/lib/work';

/** 固定の月額を登録できる区分。業務委託は成果で金額が変わるので対象外（今までどおり明細を手で入れる）。 */
export const FIXED_PAY_TYPES: WorkerType[] = ['executive', 'quasi_contractor'];
export const defaultPlanLabel = (t: WorkerType) => (t === 'executive' ? '役員報酬' : '業務委託報酬');

export type PlanRange = { starts_month: string; ends_month: string | null; active: boolean };

/** その月（期間）に、この計画は払うか。 */
export const isPlanDue = (p: PlanRange, month: string) => p.active && month >= p.starts_month && (!p.ends_month || month <= p.ends_month);

/** 2つの計画の期間が重なるか（同じ人に、同じ月の計画が2つあると二重に払うことになる）。 */
export const plansOverlap = (a: Pick<PlanRange, 'starts_month' | 'ends_month'>, b: Pick<PlanRange, 'starts_month' | 'ends_month'>) =>
  a.starts_month <= (b.ends_month ?? '9999-12') && b.starts_month <= (a.ends_month ?? '9999-12');

/** 今日、下書きを作る月（期間）: 締め日がもう過ぎた、いちばん新しい期間。今日が締め日なら、その期間。 */
export function draftPeriod(today: string, s: PaySchedule): string {
  const current = periodOf(today, s); // 今日を含む期間（その締め日は今日以降）
  return closingDate(current, s) === today ? current : addMonths(current, -1);
}

export const fixedKey = (userId: string, month: string) => `fixed:${userId}:${month}`;
export const bonusKey = (extraId: string) => `bonus:${extraId}`;
export const ADDON_PREFIX = 'addon:';

export type DraftItem = { kind: 'earning'; label: string; amount: number; sort: number; system_key: string | null };

/** 下書きの行: 固定の月額 ＋ その月の加算。控除（源泉所得税・社会保険料など）は、経理が明細で入れる。 */
export function draftItems(plan: { label: string; amount: number }, addons: { id: string; label: string; amount: number }[]): DraftItem[] {
  return [
    { kind: 'earning', label: plan.label, amount: plan.amount, sort: 0, system_key: null },
    ...addons.map((a, i) => ({ kind: 'earning' as const, label: a.label, amount: a.amount, sort: 10 + i, system_key: `${ADDON_PREFIX}${a.id}` })),
  ];
}
