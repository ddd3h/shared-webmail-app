// 給与明細の支給の行から、その人の控除を求める（DB を使わない）。登録がない人・対象でない区分の扱いをここで決める。
import { commuteTotal, DEDUCTION_TYPES, earningTotal } from '@/lib/fixed-pay';
import { toWithholdingClass, type WorkerType } from '@/lib/work';
import { computeDeductions, type DeductionCompany, type DeductionPerson, type DeductionResult } from './deductions';

/** payroll_profiles の行（生年月日は @db.Date なので UTC の 0 時の Date）。 */
export type ProfileRow = {
  birth_date: Date | null; health_insured: boolean; employment_insured: boolean; standard_monthly: number | null;
  dependents: number; resident_tax: number; resident_tax_first: number | null;
};
type Line = { kind: string; label: string; amount: number; system_key?: string | null };

export const EXECUTIVE_EMPLOYMENT_WARNING = '役員は、原則として雇用保険に入りません（兼務役員で労働者の性格がある場合だけ）。雇用保険料を引いています。入っていないなら、「控除」のタブで外してください';
export const NO_PROFILE_WARNING = '控除の登録（生年月日・扶養親族等の数など）がないため、控除は入れていません。「オートフロー → 控除」で登録してください';

export function toPerson(p: ProfileRow, withholdingClass: string | null | undefined): DeductionPerson {
  return {
    birth_date: p.birth_date ? p.birth_date.toISOString().slice(0, 10) : null,
    health_insured: p.health_insured, employment_insured: p.employment_insured, standard_monthly: p.standard_monthly,
    dependents: p.dependents, withholding_class: toWithholdingClass(withholdingClass), resident_tax: p.resident_tax, resident_tax_first: p.resident_tax_first,
  };
}

/**
 * 支給の行（`items`）から控除を計算する。控除の対象でない区分（派遣・業務委託・準業務委託）は null。
 * 登録（profile）がなければ、控除は空で、その旨の警告だけを返す。
 */
export function deductionsFor(
  company: DeductionCompany, user: { worker_type: string; withholding_class: string }, profile: ProfileRow | null | undefined,
  payDate: string, closingDate: string, items: Line[],
): DeductionResult | null {
  if (!DEDUCTION_TYPES.includes(user.worker_type as WorkerType)) return null;
  if (!profile) return { lines: [], notes: [], warnings: [NO_PROFILE_WARNING] };
  const r = computeDeductions(company, toPerson(profile, user.withholding_class), { pay_date: payDate, closing_date: closingDate, earnings_total: earningTotal(items), nontaxable: commuteTotal(items) });
  // 登録の初期値は雇用保険ありだが、法人の役員は入らないのがふつう。入れたままなら、気づけるように警告する
  if (user.worker_type === 'executive' && profile.employment_insured) r.warnings.push(EXECUTIVE_EMPLOYMENT_WARNING);
  return r;
}
