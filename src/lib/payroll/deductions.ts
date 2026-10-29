// 1か月の給与から引く控除（社会保険料・雇用保険料・源泉所得税・住民税）を計算する。DBを使わない。
// 順番: 社会保険料と雇用保険料 → それを引いた課税対象額 → 源泉所得税。住民税は市区町村の通知額をそのまま入れる。
import { CARE_RATES, EMPLOYMENT_RATES, HEALTH_RATES, PENSION_RATES, SUPPORT_RATES, type Prefecture } from './tables';
import { careApplies, employmentShare, gradeOfRemuneration, gradeOfStandard, healthApplies, pensionApplies, pensionStandard, shareOf } from './insurance';
import { taxYearFor, withholdingKo, withholdingOtsu } from './withholding';

export type DeductionCompany = {
  prefecture: Prefecture;
  /** 'next' = 翌月徴収（10月分の保険料を、11月に支給する給与から引く）、'same' = 当月徴収。 */
  timing: 'next' | 'same';
};
export type DeductionPerson = {
  birth_date: string | null;           // 'YYYY-MM-DD'。介護保険・年金・健康保険の年齢の範囲に使う
  health_insured: boolean;             // 健康保険・厚生年金に入っている
  employment_insured: boolean;         // 雇用保険に入っている
  standard_monthly: number | null;     // 標準報酬月額。空なら、この月の報酬から等級を引く
  dependents: number;                  // 扶養親族等の数（源泉）
  withholding_class: 'ko' | 'otsu';
  resident_tax: number;                // 住民税（月額）
  resident_tax_first: number | null;   // 6月に支給する給与の住民税（通知書の初回分。空なら月額と同じ）
};
export type DeductionInput = {
  pay_date: string;                    // 給与を払う日 'YYYY-MM-DD'。社会保険料を引く月と、源泉所得税の年分を決める
  closing_date: string;                // 賃金の締切日 'YYYY-MM-DD'。雇用保険料率の年度を決める（支払日ではない）
  earnings_total: number;              // 支給の合計
  nontaxable: number;                  // うち、非課税の通勤手当（月15万円までが非課税）
};
export type DeductionKey = 'health' | 'care' | 'support' | 'pension' | 'employment' | 'income_tax' | 'resident_tax';
export type DeductionLine = { key: DeductionKey; label: string; amount: number };
export type DeductionResult = { lines: DeductionLine[]; notes: string[]; warnings: string[] };

export const NONTAXABLE_COMMUTE_LIMIT = 150_000;
/** 自動で入れる控除の行の名前。「再計算」は、この名前の行を作り直す。 */
export const AUTO_LABELS = {
  health: '健康保険料', care: '介護保険料', support: '子ども・子育て支援金', pension: '厚生年金保険料', employment: '雇用保険料',
  income_tax_ko: '所得税（甲欄）', income_tax_otsu: '所得税（乙欄）', resident_tax: '住民税',
} as const;
export const AUTO_LABEL_LIST: string[] = Object.values(AUTO_LABELS);
/**
 * 「控除を再計算」で置き換える行の名前。自動の名前に加えて、手で入れた「所得税」（欄の名前がないもの。明細の画面が所得税の行として扱う）も入れる。
 * 入れないと、手で「所得税」を入れた下書きを再計算したとき、所得税の行が二重になる。
 */
export const REPLACEABLE_LABELS: string[] = [...AUTO_LABEL_LIST, '所得税'];

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const addMonth = (ym: string, d: number) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };

/** `until` の翌月以降は新しい率が未発表なので、最後の率を使う（stale = true）。`from` より前は率が分からない（null）。 */
function rateAt<T>(periods: { from: string; until: string; value: T }[], month: string): { value: T; stale: boolean } | null {
  if (month < periods[0].from) return null;
  const hit = periods.find(p => month >= p.from && month <= p.until);
  if (hit) return { value: hit.value, stale: false };
  return { value: periods[periods.length - 1].value, stale: true };
}

export function computeDeductions(company: DeductionCompany, person: DeductionPerson, input: DeductionInput): DeductionResult {
  const lines: DeductionLine[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const add = (key: DeductionKey, label: string, amount: number) => { if (amount > 0 || key === 'income_tax') lines.push({ key, label, amount }); };
  const payMonth = input.pay_date.slice(0, 7);
  const insMonth = company.timing === 'next' ? addMonth(payMonth, -1) : payMonth;
  let social = 0;

  // ---- 健康保険・介護・子ども・子育て支援金・厚生年金 ----
  if (person.health_insured) {
    const health = rateAt(HEALTH_RATES, insMonth);
    const care = rateAt(CARE_RATES, insMonth);
    const pension = rateAt(PENSION_RATES, insMonth);
    const support = rateAt(SUPPORT_RATES, insMonth);
    if (!health || !care || !pension) {
      warnings.push(`${insMonth} 分の保険料率が登録されていません。社会保険料は計算していません`);
    } else {
      const g = person.standard_monthly !== null
        ? { standard: person.standard_monthly, grade: gradeOfStandard(person.standard_monthly) }
        : (() => { const x = gradeOfRemuneration(input.earnings_total); return { standard: x.standard, grade: x.grade }; })();
      if (person.standard_monthly !== null && g.grade === null) warnings.push(`標準報酬月額 ${yen(g.standard)} は、協会けんぽの等級表にない金額です（そのまま計算しています）`);
      notes.push(person.standard_monthly !== null
        ? `標準報酬月額 ${yen(g.standard)}${g.grade ? `（${g.grade}等級）` : ''}`
        : `標準報酬月額は未登録のため、この月の支給 ${yen(input.earnings_total)} から ${yen(g.standard)}（${g.grade}等級）としました`);
      if (health.stale || care.stale || (support?.stale ?? false)) warnings.push('新しい年度の保険料率がまだ登録されていません。前の年度の料率で計算しています（協会けんぽの発表後に更新が必要です）');

      const birth = person.birth_date;
      if (!birth) warnings.push('生年月日が未登録です。介護保険（40〜64歳）と、年金・健康保険の年齢の範囲を確かめられません');
      const rate = health.value[company.prefecture];
      if (!birth || healthApplies(birth, insMonth)) {
        const hShare = shareOf(g.standard, rate);
        const withCare = !!birth && careApplies(birth, insMonth);
        // 介護に該当する人は、協会けんぽの料額表と同じく (健康保険料率＋介護保険料率) で一度だけ端数を処理し、差を介護保険料とする
        const total = withCare ? shareOf(g.standard, rate + care.value) : hShare;
        add('health', AUTO_LABELS.health, hShare);
        if (withCare) add('care', AUTO_LABELS.care, total - hShare);
        social += total;
        if (support && support.value > 0) { const s = shareOf(g.standard, support.value); add('support', AUTO_LABELS.support, s); social += s; }
        notes.push(`健康保険 ${company.prefecture} ${rate}%${withCare ? `＋介護 ${care.value}%` : ''}${support && support.value > 0 ? `＋子ども・子育て支援金 ${support.value}%` : ''}（本人負担は折半・${insMonth}分）`);
      } else notes.push('75歳以上のため、健康保険料は引きません');
      if (!birth || pensionApplies(birth, insMonth)) {
        const pShare = shareOf(pensionStandard(g.standard), pension.value);
        add('pension', AUTO_LABELS.pension, pShare);
        social += pShare;
        notes.push(`厚生年金 ${pension.value}%（標準報酬月額 ${yen(pensionStandard(g.standard))}・本人負担は折半）`);
      } else notes.push('70歳以上のため、厚生年金保険料は引きません');
    }
  }

  // ---- 雇用保険 ----
  if (person.employment_insured) {
    // 雇用保険料率は、賃金の締切日で年度が決まる（4/1以降に最初に来る締切日の賃金から新しい料率）
    const r = EMPLOYMENT_RATES.find(x => input.closing_date >= x.from && input.closing_date <= x.until) ?? null;
    const last = EMPLOYMENT_RATES[EMPLOYMENT_RATES.length - 1];
    if (!r && input.closing_date < EMPLOYMENT_RATES[0].from) warnings.push('この締切日の雇用保険料率が登録されていません。雇用保険料は計算していません');
    else {
      const rate = r ?? last;
      if (!r) warnings.push('新しい年度の雇用保険料率がまだ登録されていません。前の年度の料率で計算しています');
      const e = employmentShare(input.earnings_total, rate.permille);
      add('employment', AUTO_LABELS.employment, e);
      social += e;
      notes.push(`雇用保険 賃金 ${yen(input.earnings_total)} × ${rate.permille}/1000（一般の事業）`);
    }
  }

  // ---- 源泉所得税 ----
  const taxable = input.earnings_total - Math.min(Math.max(0, input.nontaxable), NONTAXABLE_COMMUTE_LIMIT);
  const afterSocial = taxable - social;
  const year = taxYearFor(Number(input.pay_date.slice(0, 4)));
  if (!year) warnings.push(`${input.pay_date.slice(0, 4)}年分の源泉徴収税額の計算式が登録されていません。所得税は計算していません`);
  else {
    const ko = person.withholding_class === 'ko';
    const tax = ko ? withholdingKo(afterSocial, person.dependents, year) : withholdingOtsu(afterSocial, person.dependents, year);
    add('income_tax', ko ? AUTO_LABELS.income_tax_ko : AUTO_LABELS.income_tax_otsu, tax);
    notes.push(`所得税（${ko ? '甲欄' : '乙欄'}・${year.label}）: 社会保険料等控除後 ${yen(afterSocial)}・扶養親族等 ${person.dependents}人`);
  }

  // ---- 住民税（通知額） ----
  const june = payMonth.endsWith('-06') && person.resident_tax_first !== null;
  const resident = june ? person.resident_tax_first! : person.resident_tax;
  if (resident > 0) { add('resident_tax', AUTO_LABELS.resident_tax, resident); notes.push(`住民税 ${yen(resident)}（登録された特別徴収額）`); }

  return { lines, notes, warnings };
}
