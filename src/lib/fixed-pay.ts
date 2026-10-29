// 役員・社員・準業務委託の「固定の月額」(fixed_pay_plans) から、毎月の給与明細の下書きを作るための、DB を使わない部分。
import { addMonths, closingDate, periodOf, type PaySchedule } from '@/lib/pay-schedule';
import type { WorkerType } from '@/lib/work';

/**
 * 固定の月額を登録できる区分。業務委託は成果で金額が変わるので対象外（今までどおり明細を手で入れる）。
 * 派遣は派遣元が給与を払い、会社が払うのは派遣料なので、ここにも入れない。
 */
export const FIXED_PAY_TYPES: WorkerType[] = ['executive', 'employee', 'regular', 'part', 'quasi_contractor'];
/** 社会保険料・源泉所得税などを自動で引く区分（給与を払う人）。準業務委託は給与ではないので引かない。 */
export const DEDUCTION_TYPES: WorkerType[] = ['executive', 'employee', 'regular', 'part'];
export const defaultPlanLabel = (t: WorkerType) => (t === 'executive' ? '役員報酬' : t === 'quasi_contractor' ? '業務委託報酬' : '給与');

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

export type DraftItem = { kind: 'earning' | 'deduction'; label: string; amount: number; sort: number; system_key: string | null };

export const COMMUTE_LABEL = '通勤手当';
/** 名前に「通勤」がある支給は、非課税の通勤手当として扱う（月15万円まで。それを超える分は課税）。 */
export const isCommuteLabel = (label: string) => label.includes('通勤');
/** 下書きの控除の行は sort 100 から。支給（固定の月額 0・通勤手当 1・加算 10〜）の後ろに並ぶ。 */
export const DEDUCTION_SORT = 100;

/**
 * 下書きの支給の行: 固定の月額 ＋ 通勤手当 ＋ その月の加算。
 * 加算の行に system_key は付けない（付けると、明細の画面が「自動連動・編集不可」の行として隠してしまい、経理が直せない）。
 */
export function earningItems(plan: { label: string; amount: number; commute_amount?: number }, addons: { label: string; amount: number }[]): DraftItem[] {
  return [
    { kind: 'earning', label: plan.label, amount: plan.amount, sort: 0, system_key: null },
    ...(plan.commute_amount ? [{ kind: 'earning' as const, label: COMMUTE_LABEL, amount: plan.commute_amount, sort: 1, system_key: null }] : []),
    ...addons.map((a, i) => ({ kind: 'earning' as const, label: a.label, amount: a.amount, sort: 10 + i, system_key: null })),
  ];
}

/** 自動計算した控除の行。 */
export const deductionItems = (lines: { label: string; amount: number }[], from = DEDUCTION_SORT): DraftItem[] =>
  lines.map((l, i) => ({ kind: 'deduction' as const, label: l.label, amount: l.amount, sort: from + i, system_key: null }));

/** 支給の合計（アプリが自動で足す立替金の行は含めない）と、そのうち非課税の通勤手当。 */
export const earningTotal = (items: { kind: string; amount: number; system_key?: string | null }[]) =>
  items.filter(i => i.kind === 'earning' && !i.system_key).reduce((s, i) => s + i.amount, 0);
export const commuteTotal = (items: { kind: string; label: string; amount: number; system_key?: string | null }[]) =>
  items.filter(i => i.kind === 'earning' && !i.system_key && isCommuteLabel(i.label)).reduce((s, i) => s + i.amount, 0);

export const draftItems = (plan: { label: string; amount: number; commute_amount?: number }, addons: { label: string; amount: number }[], deductions: { label: string; amount: number }[] = []): DraftItem[] =>
  [...earningItems(plan, addons), ...deductionItems(deductions)];

// ---- 明細のメモ: 計算の根拠と警告を「【自動計算】」から後ろに書く（再計算で、その部分だけ書き換える）----
export const AUTO_NOTE_MARK = '【自動計算】';
export function autoNoteSection(r: { notes: string[]; warnings: string[] }): string {
  return [AUTO_NOTE_MARK, ...r.notes.map(n => `・${n}`), ...r.warnings.map(w => `⚠ ${w}`)].join('\n');
}
/** メモの「【自動計算】」より前はそのまま残して、後ろを `section` に置き換える（null なら取り除く）。1000字を超えないようにする。 */
export function withAutoNote(note: string | null, section: string | null): string {
  const head = (note ?? '').split(AUTO_NOTE_MARK)[0].trimEnd();
  return [head, section].filter(Boolean).join('\n\n').slice(0, 990);
}
