// 役員・社員・準業務委託の「固定の月額」(fixed_pay_plans) から、毎月の給与明細の下書きを作るための、DB を使わない部分。
import { addDays, addMonths, closingDate, payDate, periodOf, type PaySchedule } from '@/lib/pay-schedule';
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

/** 当月払い（振込日が締め日より前）の区分は、振込日の何日前から下書きを作るか。全銀データを作って確かめる時間をとる。 */
export const DRAFT_LEAD_DAYS = 10;

/**
 * 今日、下書きを作る月（期間）: 締め日がもう過ぎた、いちばん新しい期間。今日が締め日なら、その期間。
 * ただし振込日が締め日より前の期間（役員報酬の当月25日払いなど）は、締め日を待つと振込日に間に合わないので、振込日の DRAFT_LEAD_DAYS 日前から作る。
 */
export function draftPeriod(today: string, s: PaySchedule): string {
  const current = periodOf(today, s); // 今日を含む期間（その締め日は今日以降）
  const closed = closingDate(current, s) === today ? current : addMonths(current, -1);
  for (const p of [addMonths(current, 1), current]) {
    const pay = payDate(p, s);
    if (p > closed && pay < closingDate(p, s) && pay <= addDays(today, DRAFT_LEAD_DAYS)) return p;
  }
  return closed;
}

export type PayDateChoice = { date: string; groups: { worker_type: WorkerType; month: string }[] };

/**
 * 「○/○振込分の下書きを作る」の選択肢: 固定報酬がある区分（`types` の順）の、今日の31日前から62日後までの振込日。
 * 同じ日に払う区分をまとめ、それぞれ何月分かを付ける（例: 11/25 は役員の11月分と、準業務委託の10月分）。
 */
export function payDateChoices(today: string, schedules: Record<WorkerType, PaySchedule>, types: WorkerType[]): PayDateChoice[] {
  const from = addDays(today, -31), to = addDays(today, 62);
  const byDate = new Map<string, PayDateChoice['groups']>();
  for (const type of types) {
    for (let k = -4; k <= 3; k++) {
      const month = addMonths(today.slice(0, 7), k);
      const date = payDate(month, schedules[type]);
      if (date < from || date > to) continue;
      byDate.set(date, [...(byDate.get(date) ?? []), { worker_type: type, month }]);
    }
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, groups]) => ({ date, groups }));
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
