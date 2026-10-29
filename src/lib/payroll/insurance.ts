// 社会保険料（健康保険・介護・子ども・子育て支援金・厚生年金）と雇用保険料の、本人負担分の計算。DBを使わない。
// 本人負担は労使折半。給与から引くときの端数は「50銭以下は切り捨て、50銭を超えたら切り上げ」（協会けんぽの規則）。
import { GRADES, PENSION_MAX, PENSION_MIN } from './tables';

/** n/d を、50銭以下切り捨て・50銭を超えたら切り上げで整数にする（正の整数どうしの割り算。浮動小数点を使わない）。 */
export function roundHalfDown(n: number, d: number): number {
  return Math.floor((2 * n + d - 1) / (2 * d));
}

const hundredths = (pct: number) => Math.round(pct * 100); // 9.85% -> 985

/** 標準報酬月額 × 料率(%) の本人負担分（折半）。 */
export function shareOf(standard: number, ratePct: number): number {
  return roundHalfDown(standard * hundredths(ratePct), 20_000);
}

/** 報酬月額から、標準報酬月額と等級（1〜50）を引く。 */
export function gradeOfRemuneration(amount: number): { grade: number; standard: number } {
  const i = GRADES.findIndex(([, from, to]) => amount >= from && (to === null || amount < to));
  const idx = i < 0 ? GRADES.length - 1 : i;
  return { grade: idx + 1, standard: GRADES[idx][0] };
}

/** 登録された標準報酬月額が、等級表の値かどうか。等級（1〜50）を返す。 */
export function gradeOfStandard(standard: number): number | null {
  const i = GRADES.findIndex(([s]) => s === standard);
  return i < 0 ? null : i + 1;
}

export const pensionStandard = (standard: number) => Math.min(PENSION_MAX, Math.max(PENSION_MIN, standard));

/** 雇用保険（労働者負担）: 賃金 × ‰。1円未満は50銭以下切り捨て、50銭1厘以上切り上げ。 */
export function employmentShare(wage: number, permille: number): number {
  return roundHalfDown(wage * Math.round(permille * 10), 10_000);
}

// ---- 年齢による加入の範囲（保険料の対象月 = 'YYYY-MM'）----
const ymOf = (date: string) => date.slice(0, 7);

function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}
function dayBefore(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** 介護保険の第2号被保険者: 40歳に達する日（誕生日の前日）の属する月から、65歳に達する日の属する月の前月まで。 */
export function careApplies(birth: string, insMonth: string): boolean {
  return insMonth >= ymOf(dayBefore(addYears(birth, 40))) && insMonth < ymOf(dayBefore(addYears(birth, 65)));
}
/** 厚生年金: 70歳の誕生日の属する月の前月まで。 */
export const pensionApplies = (birth: string, insMonth: string) => insMonth < ymOf(addYears(birth, 70));
/** 健康保険: 75歳の誕生日の属する月の前月まで（そのあとは後期高齢者医療）。 */
export const healthApplies = (birth: string, insMonth: string) => insMonth < ymOf(addYears(birth, 75));
