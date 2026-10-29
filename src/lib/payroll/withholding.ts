// 源泉所得税（月額表）。国税庁の「電算機計算の特例」（甲欄）と「電算機計算」（乙欄）の計算式。DBを使わない。
// 月額表の税額とは、階級の中間値で計算してあるぶん数十円の差が出ることがあるが、年末調整で精算される（国税庁の説明どおり）。
import { TAX_YEARS, type TaxYear } from './tables';

export function taxYearFor(year: number): TaxYear | null {
  const found = [...TAX_YEARS].reverse().find(t => year >= t.fromYear);
  return found ? found.table : null;
}

/** 給与所得控除の額（1円未満は切り上げ）。 */
export function salaryDeduction(a: number, t: TaxYear): number {
  if (a <= t.floorUpTo) return t.floorAmount;
  if (a <= 299_999) return Math.ceil((a * 30) / 100) + 6_667;
  if (a <= 549_999) return Math.ceil((a * 20) / 100) + 36_667;
  if (a <= 708_330) return Math.ceil((a * 10) / 100) + 91_667;
  return 162_500;
}

/** 基礎控除の額。 */
export function basicDeduction(a: number, t: TaxYear): number {
  if (a <= 2_120_833) return t.basicTop;
  if (a <= 2_162_499) return 40_000;
  if (a <= 2_204_166) return 26_667;
  if (a <= 2_245_833) return 13_334;
  return 0;
}

// 税額の算式: (B × 税率 − 控除額)。税率は 1/100000 単位の整数（5.105% = 5105）。
const KO_BRACKETS: [upTo: number, rate: number, minus: number][] = [
  [162_500, 5_105, 0], [275_000, 10_210, 8_296], [579_166, 20_420, 36_374], [750_000, 23_483, 54_113],
  [1_500_000, 33_693, 130_688], [3_333_333, 40_840, 237_893], [Infinity, 45_945, 408_061],
];
const OTSU_BRACKETS: [upTo: number, rate: number, minus: number][] = [
  [162_500, 5_000, 0], [275_000, 10_000, 8_125], [579_166, 20_000, 35_625], [750_000, 23_000, 53_000],
  [1_500_000, 33_000, 128_000], [3_333_333, 40_000, 233_000], [Infinity, 45_000, 0],
];

function bracketTax(b: number, brackets: typeof KO_BRACKETS): number {
  const [, rate, minus] = brackets.find(([upTo]) => b <= upTo)!;
  return (b * rate - minus * 100_000) / 100_000;
}

/**
 * 甲欄（扶養控除等申告書を出している主たる給与）。`a` = 社会保険料等控除後の給与等の金額、`n` = 扶養親族等の数
 * （源泉控除対象配偶者・源泉控除対象親族・本人が障害者／寡婦／ひとり親／勤労学生であるぶん・障害者である親族のぶん、の合計）。
 */
export function withholdingKo(a: number, n: number, t: TaxYear): number {
  if (a <= 0) return 0;
  const b = a - salaryDeduction(a, t) - 31_667 * n - basicDeduction(a, t);
  if (b <= 0) return 0;
  return Math.floor((bracketTax(b, KO_BRACKETS) + 5) / 10) * 10; // 10円未満は四捨五入
}

const round100 = (x: number) => Math.floor((x + 50) / 100) * 100; // 50円未満切り捨て、50円以上100円未満は100円に切り上げ

/** 乙欄の、計算基準額 base を使った税額の計算の途中（第1表〜第3表）。 */
function otsuStep(x: number, t: TaxYear): number {
  const b = x - salaryDeduction(x, t) - basicDeduction(x, t);
  return b <= 0 ? 0 : Math.floor(bracketTax(b, OTSU_BRACKETS)); // 1円未満切り捨て
}

/** 乙欄（従たる給与）。`n` = 従たる給与についての扶養控除等申告書で控除する扶養親族等の数（ふつうは 0）。 */
export function withholdingOtsu(a: number, n: number, t: TaxYear): number {
  if (a <= 0) return 0;
  let tax: number;
  if (a < 105_000) tax = Math.floor((a * 3_063) / 100_000);
  else if (a <= 740_000) {
    let base = 740_000;
    if (a < 740_000) {
      const step = a <= 220_999 ? 2_000 : 3_000;
      const min = a <= 220_999 ? 105_000 : 221_000;
      base = a - ((a - min) % step);
    }
    const c = round100(otsuStep((base * 5) / 2, t) - otsuStep((base * 3) / 2, t));
    tax = round100((c * 1021) / 1000);
  } else if (a < 1_710_000) tax = Math.floor(259_200 + ((a - 740_000) * 4_084) / 10_000);
  else tax = Math.floor(655_400 + ((a - 1_710_000) * 45_945) / 100_000);
  return Math.max(0, tax - 1_610 * n);
}
