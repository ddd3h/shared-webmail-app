// 年末調整 (year-end tax adjustment): what a person declares for one calendar year. Pure helpers (no I/O) so they are easy to test.
// The My Number is deliberately not collected anywhere: the company handles it on paper / in its own secure system.
import { z } from 'zod';
import { isValidDateString, paysSalary, type WithholdingClass, type WorkerType } from '@/lib/work';

/** Who declares: people paid a salary (給与) and 役員, whose 源泉徴収 is on the 甲欄. Dispatched workers are adjusted by their agency, contractors
 *  by themselves, and a second job (乙欄) is not adjusted here. */
export const hasYearEnd = (t: WorkerType, withholding: WithholdingClass = 'ko') => (paysSalary(t) || t === 'executive') && withholding === 'ko';

export const YEAR_MIN = 2020;
export const YEAR_MAX = 2100;
export const isValidYear = (n: number) => Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX;

export const DISABILITIES = ['none', 'general', 'special'] as const;
export type Disability = (typeof DISABILITIES)[number];
export const DISABILITY_LABEL: Record<Disability, string> = { none: 'なし', general: '障害者', special: '特別障害者' };

export const SINGLE_STATUSES = ['none', 'widow', 'single_parent'] as const;
export type SingleStatus = (typeof SINGLE_STATUSES)[number];
export const SINGLE_STATUS_LABEL: Record<SingleStatus, string> = { none: 'なし', widow: '寡婦', single_parent: 'ひとり親' };

export const RELATIONS = ['child', 'parent', 'grandparent', 'sibling', 'other'] as const;
export type Relation = (typeof RELATIONS)[number];
export const RELATION_LABEL: Record<Relation, string> = { child: '子', parent: '親', grandparent: '祖父母', sibling: '兄弟姉妹', other: 'その他の親族' };

export const STATUSES = ['draft', 'submitted', 'confirmed'] as const;
export type YearEndStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<YearEndStatus, string> = { draft: '下書き', submitted: '提出済み', confirmed: '確認済み' };

export const MAX_DEPENDENTS = 10;
const MAX_YEN = 999_999_999;

// A draft may be incomplete (empty strings), so the shape is checked here and the completeness only when it is submitted (submitProblems).
const date = z.string().refine(s => s === '' || isValidDateString(s), 'date');
const yen = z.number().int().min(0).max(MAX_YEN).nullable();
const person = {
  name: z.string().trim().max(60),
  birth_date: date,
  cohabiting: z.boolean(),
  income_estimate: yen, // 合計所得金額の見込み（円）
  disability: z.enum(DISABILITIES),
  non_resident: z.boolean(), // 国外居住
};
const spouseSchema = z.object(person);
const dependentSchema = z.object({ ...person, relation: z.enum(RELATIONS) });

export const yearEndSchema = z.object({
  self: z.object({ single_status: z.enum(SINGLE_STATUSES), disability: z.enum(DISABILITIES), working_student: z.boolean() }),
  spouse: spouseSchema.nullable(),
  dependents: z.array(dependentSchema).max(MAX_DEPENDENTS),
  deductions: z.object({
    life_insurance: yen, // 生命保険料（年間の支払額）
    earthquake_insurance: yen, // 地震保険料
    social_insurance: yen, // 給与から引かれていない社会保険料（国民年金など）
    small_business_mutual_aid: yen, // 小規模企業共済・iDeCo の掛金
    housing_loan: z.boolean(), // 住宅ローン控除を受ける（申告書は別に提出）
  }),
  previous_job: z.object({ has: z.boolean(), company: z.string().trim().max(100), income: yen, tax_withheld: yen, social_insurance: yen }),
  note: z.string().trim().max(500),
});
export type YearEndData = z.infer<typeof yearEndSchema>;
export type Person = z.infer<typeof spouseSchema>;
export type Dependent = z.infer<typeof dependentSchema>;

export const blankPerson = (): Person => ({ name: '', birth_date: '', cohabiting: true, income_estimate: null, disability: 'none', non_resident: false });
export const blankDependent = (): Dependent => ({ ...blankPerson(), relation: 'child' });
export const blankYearEnd = (): YearEndData => ({
  self: { single_status: 'none', disability: 'none', working_student: false },
  spouse: null,
  dependents: [],
  deductions: { life_insurance: null, earthquake_insurance: null, social_insurance: null, small_business_mutual_aid: null, housing_loan: false },
  previous_job: { has: false, company: '', income: null, tax_withheld: null, social_insurance: null },
  note: '',
});

/** What is still missing before it can be submitted: dotted paths such as `spouse.name` or `dependents.0.birth_date`. */
export function submitProblems(d: YearEndData): string[] {
  const out: string[] = [];
  const check = (p: Person, path: string) => {
    if (!p.name) out.push(`${path}.name`);
    if (!p.birth_date) out.push(`${path}.birth_date`);
    if (p.income_estimate === null) out.push(`${path}.income_estimate`);
  };
  if (d.spouse) check(d.spouse, 'spouse');
  d.dependents.forEach((p, i) => check(p, `dependents.${i}`));
  if (d.previous_job.has && !d.previous_job.company) out.push('previous_job.company');
  return out;
}

// ── 目安の判定 ────────────────────────────────────────────────────────────────
// A hint shown beside each family member so that the person (and finance staff) can see which deduction is likely. Not a ruling:
// the real decision is made by the staff, with the person's own income (本人の合計所得1,000万円以下 etc.) in mind.
/** 配偶者控除 / 扶養控除の所得の上限（合計所得金額 58万円 = 給与収入のみなら年123万円）。令和7年分から。 */
export const INCOME_LIMIT = 580_000;
/** 配偶者特別控除の所得の上限（合計所得金額 133万円）。 */
export const SPOUSE_SPECIAL_LIMIT = 1_330_000;
/** 特定親族特別控除（19〜22歳）の所得の上限（合計所得金額 123万円）。令和7年分から。 */
export const SPECIFIC_RELATIVE_LIMIT = 1_230_000;

/** Age on 31 December of `year` (the day that counts for the deductions), or null when the birth date is missing / in the future. */
export function ageAtYearEnd(birthDate: string, year: number): number | null {
  if (!isValidDateString(birthDate)) return null;
  const age = year - Number(birthDate.slice(0, 4)); // by 31 December everybody has had that year's birthday
  return age >= 0 ? age : null;
}

export function spouseHint(p: Person): string {
  if (p.income_estimate === null) return '所得の見込みを入れると、控除の目安が出ます';
  if (p.income_estimate <= INCOME_LIMIT) return '配偶者控除の対象になる可能性があります';
  if (p.income_estimate <= SPOUSE_SPECIAL_LIMIT) return '配偶者特別控除の対象になる可能性があります';
  return '控除の対象外になる可能性があります（所得が基準を超えています）';
}

export function dependentHint(p: Dependent, year: number): string {
  const age = ageAtYearEnd(p.birth_date, year);
  if (age === null) return '生年月日を入れると、控除の目安が出ます';
  if (p.income_estimate === null) return '所得の見込みを入れると、控除の目安が出ます';
  if (age < 16) return '16歳未満（扶養控除はありません。住民税の扶養には数えます）';
  if (p.income_estimate > INCOME_LIMIT) {
    if (age >= 19 && age <= 22 && p.income_estimate <= SPECIFIC_RELATIVE_LIMIT) return '特定親族特別控除の対象になる可能性があります（19〜22歳）';
    return '控除の対象外になる可能性があります（所得が基準を超えています）';
  }
  if (age >= 70) return p.cohabiting && (p.relation === 'parent' || p.relation === 'grandparent') ? '老人扶養親族（同居老親等）になる可能性があります' : '老人扶養親族になる可能性があります';
  if (age >= 19 && age <= 22) return '特定扶養親族になる可能性があります（19〜22歳）';
  return '一般の控除対象扶養親族になる可能性があります';
}

// ── CSV（経理・人事が、給与ソフトへ移すときに使う） ────────────────────────────
export type YearEndRow = { name: string; worker_type: string; status: YearEndStatus | 'none'; data: YearEndData | null; submitted_at: Date | null; confirmed_at: Date | null };

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  // a cell starting with = + - @ would be run as a formula by a spreadsheet
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const yn = (b: boolean) => (b ? 'あり' : '');
const personText = (p: Person) => `${p.name}（${p.birth_date}、所得${p.income_estimate ?? ''}円${p.cohabiting ? '' : '、別居'}${p.non_resident ? '、国外居住' : ''}${p.disability !== 'none' ? `、${DISABILITY_LABEL[p.disability]}` : ''}）`;

export const CSV_HEADER = ['氏名', '区分', '状態', '寡婦・ひとり親', '本人の障害', '勤労学生', '配偶者', '扶養親族の数', '扶養親族', '生命保険料', '地震保険料', '社会保険料（天引き以外）', '小規模企業共済・iDeCo', '住宅ローン控除', '前職あり', '前職の会社', '前職の支払金額', '前職の源泉徴収税額', '前職の社会保険料', '備考'];

export function yearEndCsv(rows: YearEndRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    const d = r.data;
    const cells: (string | number | null)[] = d ? [
      r.name, r.worker_type, STATUS_LABEL[r.status as YearEndStatus] ?? '', SINGLE_STATUS_LABEL[d.self.single_status], DISABILITY_LABEL[d.self.disability], yn(d.self.working_student),
      d.spouse ? personText(d.spouse) : '', d.dependents.length, d.dependents.map(p => `${RELATION_LABEL[p.relation]}: ${personText(p)}`).join(' / '),
      d.deductions.life_insurance, d.deductions.earthquake_insurance, d.deductions.social_insurance, d.deductions.small_business_mutual_aid, yn(d.deductions.housing_loan),
      yn(d.previous_job.has), d.previous_job.company, d.previous_job.income, d.previous_job.tax_withheld, d.previous_job.social_insurance, d.note,
    ] : [r.name, r.worker_type, '未入力', ...Array(CSV_HEADER.length - 3).fill('')];
    lines.push(cells.map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
