import { describe, expect, it } from 'vitest';
import { computeDeductions, AUTO_LABEL_LIST, type DeductionPerson } from '@/lib/payroll/deductions';
import { careApplies, employmentShare, gradeOfRemuneration, gradeOfStandard, healthApplies, pensionApplies, pensionStandard, roundHalfDown, shareOf } from '@/lib/payroll/insurance';
import { taxYearFor, withholdingKo, withholdingOtsu } from '@/lib/payroll/withholding';
import { GRADES, PENSION_MAX, PENSION_MIN, PREFECTURES } from '@/lib/payroll/tables';

// 協会けんぽ 東京都（令和8年3月分〜、健康保険 9.85%・介護 1.62%・子ども・子育て支援金 0.23%・厚生年金 18.3%）の保険料額表。
// [等級, 標準報酬月額, 健康保険料(折半), 健康保険＋介護(折半), 子ども・子育て支援金(折半), 厚生年金(折半)]。
// 折半額は 50銭以下切り捨て・50銭を超えたら切り上げ済み。厚生年金の等級にない 1〜3 級・50 級は、下限／上限の標準報酬月額で計算する。
const TOKYO: [number, number, number, number, number, number | null][] = [
  [1, 58000, 2856, 3326, 67, null],
  [2, 68000, 3349, 3900, 78, null],
  [3, 78000, 3841, 4473, 90, null],
  [4, 88000, 4334, 5047, 101, 8052],
  [5, 98000, 4826, 5620, 113, 8967],
  [6, 104000, 5122, 5964, 120, 9516],
  [7, 110000, 5417, 6308, 126, 10065],
  [8, 118000, 5811, 6767, 136, 10797],
  [9, 126000, 6205, 7226, 145, 11529],
  [10, 134000, 6599, 7685, 154, 12261],
  [11, 142000, 6993, 8144, 163, 12993],
  [12, 150000, 7387, 8602, 172, 13725],
  [13, 160000, 7880, 9176, 184, 14640],
  [14, 170000, 8372, 9749, 195, 15555],
  [15, 180000, 8865, 10323, 207, 16470],
  [16, 190000, 9357, 10896, 218, 17385],
  [17, 200000, 9850, 11470, 230, 18300],
  [18, 220000, 10835, 12617, 253, 20130],
  [19, 240000, 11820, 13764, 276, 21960],
  [20, 260000, 12805, 14911, 299, 23790],
  [21, 280000, 13790, 16058, 322, 25620],
  [22, 300000, 14775, 17205, 345, 27450],
  [23, 320000, 15760, 18352, 368, 29280],
  [24, 340000, 16745, 19499, 391, 31110],
  [25, 360000, 17730, 20646, 414, 32940],
  [26, 380000, 18715, 21793, 437, 34770],
  [27, 410000, 20192, 23513, 471, 37515],
  [28, 440000, 21670, 25234, 506, 40260],
  [29, 470000, 23147, 26954, 540, 43005],
  [30, 500000, 24625, 28675, 575, 45750],
  [31, 530000, 26102, 30395, 609, 48495],
  [32, 560000, 27580, 32116, 644, 51240],
  [33, 590000, 29057, 33836, 678, 53985],
  [34, 620000, 30535, 35557, 713, 56730],
  [35, 650000, 32012, 37277, 747, 59475],
  [36, 680000, 33490, 38998, 782, null],
  [37, 710000, 34967, 40718, 816, null],
  [38, 750000, 36937, 43012, 862, null],
  [39, 790000, 38907, 45306, 908, null],
  [40, 830000, 40877, 47600, 954, null],
  [41, 880000, 43340, 50468, 1012, null],
  [42, 930000, 45802, 53335, 1069, null],
  [43, 980000, 48265, 56203, 1127, null],
  [44, 1030000, 50727, 59070, 1184, null],
  [45, 1090000, 53682, 62511, 1253, null],
  [46, 1150000, 56637, 65952, 1322, null],
  [47, 1210000, 59592, 69393, 1391, null],
  [48, 1270000, 62547, 72834, 1460, null],
  [49, 1330000, 65502, 76275, 1529, null],
  [50, 1390000, 68457, 79716, 1598, null],
];

describe('社会保険料（協会けんぽ 東京都）', () => {
  it('等級表は 50 等級で、報酬月額の範囲に隙間がない', () => {
    expect(GRADES).toHaveLength(50);
    for (let i = 1; i < GRADES.length; i++) expect(GRADES[i][1]).toBe(GRADES[i - 1][2]);
    expect(GRADES[0][1]).toBe(0);
    expect(GRADES[49][2]).toBeNull();
    expect(PREFECTURES).toHaveLength(47);
  });

  it.each(TOKYO)('%i 級 標準報酬月額 %i: 本人負担が料額表と同じ', (grade, std, health, healthCare, support, pension) => {
    expect(gradeOfStandard(std)).toBe(grade);
    expect(shareOf(std, 9.85)).toBe(health);
    expect(shareOf(std, 9.85 + 1.62)).toBe(healthCare);
    expect(shareOf(std, 0.23)).toBe(support);
    const p = pension ?? shareOf(std < PENSION_MIN ? PENSION_MIN : PENSION_MAX, 18.3);
    expect(shareOf(pensionStandard(std), 18.3)).toBe(p);
  });

  it('報酬月額から等級を引く（範囲の下限は含み、上限は含まない）', () => {
    expect(gradeOfRemuneration(0)).toEqual({ grade: 1, standard: 58_000 });
    expect(gradeOfRemuneration(62_999)).toEqual({ grade: 1, standard: 58_000 });
    expect(gradeOfRemuneration(63_000)).toEqual({ grade: 2, standard: 68_000 });
    expect(gradeOfRemuneration(290_000)).toEqual({ grade: 22, standard: 300_000 });
    expect(gradeOfRemuneration(309_999)).toEqual({ grade: 22, standard: 300_000 });
    expect(gradeOfRemuneration(310_000)).toEqual({ grade: 23, standard: 320_000 });
    expect(gradeOfRemuneration(9_999_999)).toEqual({ grade: 50, standard: 1_390_000 });
  });

  it('50銭ちょうどは切り捨て、50銭を超えたら切り上げ', () => {
    expect(roundHalfDown(1, 2)).toBe(0);   // 0.5 -> 0
    expect(roundHalfDown(3, 2)).toBe(1);   // 1.5 -> 1
    expect(roundHalfDown(51, 100)).toBe(1); // 0.51 -> 1
    expect(roundHalfDown(50, 100)).toBe(0); // 0.50 -> 0
    expect(shareOf(300_000, 9.85)).toBe(14_775);
  });

  it('雇用保険: 賃金 × 5/1000 を 50銭以下切り捨て', () => {
    expect(employmentShare(300_000, 5)).toBe(1_500);
    expect(employmentShare(100_100, 5)).toBe(500);   // 500.5 -> 500
    expect(employmentShare(100_300, 5)).toBe(501);   // 501.5 は50銭ちょうどなので切り捨て
    expect(employmentShare(100_120, 5)).toBe(501);   // 500.6 -> 501
    expect(employmentShare(300_000, 5.5)).toBe(1_650);
  });
});

describe('年齢による範囲（保険料の対象月）', () => {
  it('介護保険: 40歳になる日（誕生日の前日）の月から、65歳になる日の月の前月まで', () => {
    expect(careApplies('1986-06-15', '2026-05')).toBe(false);
    expect(careApplies('1986-06-15', '2026-06')).toBe(true);
    expect(careApplies('1986-06-01', '2026-05')).toBe(true); // 前日が 5/31
    expect(careApplies('1961-06-15', '2026-05')).toBe(true);
    expect(careApplies('1961-06-15', '2026-06')).toBe(false);
    expect(careApplies('1961-06-01', '2026-04')).toBe(true); // 前日が 5/31 → 5月から外れる
    expect(careApplies('1961-06-01', '2026-05')).toBe(false);
  });
  it('厚生年金は 70歳の誕生日の月から、健康保険は 75歳の誕生日の月から外れる', () => {
    expect(pensionApplies('1956-06-10', '2026-05')).toBe(true);
    expect(pensionApplies('1956-06-10', '2026-06')).toBe(false);
    expect(healthApplies('1951-06-10', '2026-05')).toBe(true);
    expect(healthApplies('1951-06-10', '2026-06')).toBe(false);
  });
});

describe('源泉所得税（国税庁 令和8年分 電算機計算の特例）', () => {
  const t = taxYearFor(2026)!;
  it('国税庁の計算例と同じ額になる', () => {
    expect(withholdingKo(175_000, 2, t)).toBe(210);
    expect(withholdingKo(446_000, 8, t)).toBe(940);
    expect(withholdingKo(775_200, 3, t)).toBe(59_470);
  });
  it('令和8年分より前は計算式がない。令和9年分からは別の式', () => {
    expect(taxYearFor(2025)).toBeNull();
    expect(taxYearFor(2027)!.label).toContain('令和9年分');
    expect(taxYearFor(2030)!.label).toContain('令和9年分');
  });
  it('0 以下や、控除で課税額が残らなければ 0', () => {
    expect(withholdingKo(0, 0, t)).toBe(0);
    expect(withholdingKo(88_000, 0, t)).toBe(0);
    expect(withholdingOtsu(0, 0, t)).toBe(0);
  });

  // 月額表（給与所得の源泉徴収税額表）の行。[下限, 上限, 甲欄 扶養0〜7人, 乙欄]。電算機計算の特例は表と数十円まで違うことがある。
  const MONTHLY: [number, number, number[], number][] = [
    [302_000, 305_000, [8_060, 6_440, 4_820, 3_210, 1_590, 0, 0, 0], 54_500],
    [401_000, 404_000, [15_900, 12_670, 9_430, 7_250, 5_640, 4_010, 2_400, 790], 90_500],
    [500_000, 503_000, [28_190, 21_730, 17_520, 14_280, 11_060, 8_060, 6_440, 4_830], 145_700],
    [602_000, 605_000, [45_950, 39_480, 33_020, 26_550, 20_080, 16_700, 13_470, 10_230], 197_000],
    [737_000, 740_000, [71_380, 64_900, 58_440, 51_980, 45_510, 39_040, 32_580, 26_110], 257_700],
  ];
  it.each(MONTHLY)('甲欄 %i〜%i円は月額表と 10円以内', (lo, hi, ko) => {
    const mid = Math.floor((lo + hi) / 2);
    ko.forEach((expected, n) => expect(Math.abs(withholdingKo(mid, n, t) - expected)).toBeLessThanOrEqual(10));
  });
  it.each(MONTHLY)('乙欄 %i〜%i円は月額表と同じ額', (lo, hi, _ko, otsu) => {
    expect(withholdingOtsu(lo, 0, t)).toBe(otsu);
    expect(withholdingOtsu(hi - 1, 0, t)).toBe(otsu);
  });
  it('乙欄 低い額・高い額・扶養親族等', () => {
    expect(withholdingOtsu(100_000, 0, t)).toBe(3_063);
    expect(withholdingOtsu(105_000, 0, t)).toBe(3_800);
    expect(withholdingOtsu(111_000, 0, t)).toBe(4_000);
    expect(withholdingOtsu(201_000, 0, t)).toBe(20_400);
    expect(withholdingOtsu(221_000, 0, t)).toBe(26_400);
    expect(withholdingOtsu(224_000, 0, t)).toBe(27_500);
    expect(withholdingOtsu(201_000, 1, t)).toBe(20_400 - 1_610);
    expect(withholdingOtsu(800_000, 0, t)).toBe(283_704);
    expect(withholdingOtsu(1_800_000, 0, t)).toBe(655_400 + Math.floor(90_000 * 0.45945));
  });
});

// ---- 控除の組み立て ----
const person = (over: Partial<DeductionPerson> = {}): DeductionPerson => ({
  birth_date: '1990-05-10', health_insured: true, employment_insured: true, standard_monthly: 300_000, dependents: 0,
  withholding_class: 'ko', resident_tax: 0, resident_tax_first: null, ...over,
});
const company = { prefecture: '東京都' as const, timing: 'next' as const };
const amountOf = (r: ReturnType<typeof computeDeductions>, key: string) => r.lines.find(l => l.key === key)?.amount;

describe('computeDeductions', () => {
  it('30万円・40歳未満: 健康保険 14,775・子ども・子育て支援金 345・厚生年金 27,450・雇用保険 1,500、その残りに所得税', () => {
    const r = computeDeductions(company, person(), { pay_date: '2026-11-25', earnings_total: 300_000, nontaxable: 0 });
    expect(amountOf(r, 'health')).toBe(14_775);
    expect(amountOf(r, 'care')).toBeUndefined();
    expect(amountOf(r, 'support')).toBe(345);
    expect(amountOf(r, 'pension')).toBe(27_450);
    expect(amountOf(r, 'employment')).toBe(1_500);
    const social = 14_775 + 345 + 27_450 + 1_500;
    expect(amountOf(r, 'income_tax')).toBe(withholdingKo(300_000 - social, 0, taxYearFor(2026)!));
    expect(amountOf(r, 'income_tax')).toBe(6_340);
    expect(r.warnings).toEqual([]);
  });

  it('40〜64歳は介護保険料が付く（健康保険＋介護 17,205 から健康保険 14,775 を引いた 2,430）', () => {
    const r = computeDeductions(company, person({ birth_date: '1975-03-20' }), { pay_date: '2026-11-25', earnings_total: 300_000, nontaxable: 0 });
    expect(amountOf(r, 'health')).toBe(14_775);
    expect(amountOf(r, 'care')).toBe(2_430);
  });

  it('翌月徴収は前の月の保険料、当月徴収はその月の保険料。介護保険の始まりの月がずれる', () => {
    const p = person({ birth_date: '1986-12-15' }); // 40歳になる日は 2026-12-14 → 12月分から介護
    const input = { pay_date: '2026-12-25', earnings_total: 300_000, nontaxable: 0 };
    const next = computeDeductions({ ...company, timing: 'next' }, p, input);
    const same = computeDeductions({ ...company, timing: 'same' }, p, input);
    expect(amountOf(next, 'care')).toBeUndefined(); // 11月分
    expect(amountOf(same, 'care')).toBe(2_430);     // 12月分
    expect(next.notes.join('\n')).toContain('2026-11分');
    expect(same.notes.join('\n')).toContain('2026-12分');
  });

  it('標準報酬月額が未登録なら、その月の支給から等級を引き、ノートに書く', () => {
    const r = computeDeductions(company, person({ standard_monthly: null }), { pay_date: '2026-11-25', earnings_total: 297_000, nontaxable: 0 });
    expect(amountOf(r, 'health')).toBe(14_775);
    expect(r.notes.join('\n')).toContain('未登録');
  });

  it('通勤手当（非課税）は所得税の対象から外すが、社会保険料と雇用保険料の対象には含める', () => {
    const base = { pay_date: '2026-11-25', earnings_total: 330_000 };
    const r = computeDeductions(company, person(), { ...base, nontaxable: 30_000 });
    const social = 14_775 + 345 + 27_450 + employmentShare(330_000, 5);
    expect(amountOf(r, 'employment')).toBe(1_650);
    expect(amountOf(r, 'income_tax')).toBe(withholdingKo(300_000 - social, 0, taxYearFor(2026)!));
    // 月15万円を超える分は課税
    const big = computeDeductions(company, person({ health_insured: false, employment_insured: false }), { pay_date: '2026-11-25', earnings_total: 400_000, nontaxable: 200_000 });
    expect(amountOf(big, 'income_tax')).toBe(withholdingKo(250_000, 0, taxYearFor(2026)!));
  });

  it('乙欄は「所得税（乙欄）」、甲欄は「所得税（甲欄）」の名前で出す。扶養は甲欄で効く', () => {
    const input = { pay_date: '2026-11-25', earnings_total: 400_000, nontaxable: 0 };
    const ko = computeDeductions(company, person({ health_insured: false, employment_insured: false, dependents: 2 }), input);
    const otsu = computeDeductions(company, person({ health_insured: false, employment_insured: false, withholding_class: 'otsu' }), input);
    expect(ko.lines.find(l => l.key === 'income_tax')!.label).toBe('所得税（甲欄）');
    expect(otsu.lines.find(l => l.key === 'income_tax')!.label).toBe('所得税（乙欄）');
    expect(amountOf(ko, 'income_tax')).toBe(withholdingKo(400_000, 2, taxYearFor(2026)!));
    expect(amountOf(otsu, 'income_tax')).toBe(withholdingOtsu(400_000, 0, taxYearFor(2026)!));
  });

  it('所得税が 0 円でも行は残す。引く保険がなければ、その行は出さない', () => {
    const r = computeDeductions(company, person({ health_insured: false, employment_insured: false }), { pay_date: '2026-11-25', earnings_total: 100_000, nontaxable: 0 });
    expect(r.lines).toEqual([{ key: 'income_tax', label: '所得税（甲欄）', amount: 0 }]);
  });

  it('住民税は登録した額。6月だけは初回分（未入力なら月額と同じ）', () => {
    const p = person({ health_insured: false, employment_insured: false, resident_tax: 10_000, resident_tax_first: 12_400 });
    const input = { earnings_total: 300_000, nontaxable: 0 };
    expect(amountOf(computeDeductions(company, p, { ...input, pay_date: '2026-06-25' }), 'resident_tax')).toBe(12_400);
    expect(amountOf(computeDeductions(company, p, { ...input, pay_date: '2026-07-25' }), 'resident_tax')).toBe(10_000);
    const q = person({ health_insured: false, employment_insured: false, resident_tax: 10_000 });
    expect(amountOf(computeDeductions(company, q, { ...input, pay_date: '2026-06-25' }), 'resident_tax')).toBe(10_000);
  });

  it('行の名前は、再計算で置き換える名前の一覧に全部入っている', () => {
    const r = computeDeductions(company, person({ birth_date: '1975-03-20', resident_tax: 8_000 }), { pay_date: '2026-11-25', earnings_total: 300_000, nontaxable: 0 });
    expect(r.lines.length).toBeGreaterThanOrEqual(7);
    for (const l of r.lines) expect(AUTO_LABEL_LIST).toContain(l.label);
  });

  it('警告: 生年月日なし／率が未登録の月／新しい年度の率がまだない', () => {
    const noBirth = computeDeductions(company, person({ birth_date: null }), { pay_date: '2026-11-25', earnings_total: 300_000, nontaxable: 0 });
    expect(noBirth.warnings.join('\n')).toContain('生年月日');
    const before = computeDeductions(company, person(), { pay_date: '2026-03-25', earnings_total: 300_000, nontaxable: 0 }); // 2026-02 分は率が未登録
    expect(before.warnings.join('\n')).toContain('2026-02');
    expect(amountOf(before, 'health')).toBeUndefined();
    const stale = computeDeductions(company, person(), { pay_date: '2027-06-25', earnings_total: 300_000, nontaxable: 0 });
    expect(stale.warnings.join('\n')).toContain('前の年度の料率');
    expect(amountOf(stale, 'health')).toBe(14_775);
  });

  it('登録のない年分は所得税を計算せず、警告を出す', () => {
    const r = computeDeductions(company, person({ health_insured: false, employment_insured: false }), { pay_date: '2025-12-25', earnings_total: 300_000, nontaxable: 0 });
    expect(r.lines.find(l => l.key === 'income_tax')).toBeUndefined();
    expect(r.warnings.join('\n')).toContain('2025年分');
  });

  it('70歳以上は厚生年金、75歳以上は健康保険を引かない', () => {
    const input = { pay_date: '2026-11-25', earnings_total: 300_000, nontaxable: 0 };
    const seventy = computeDeductions(company, person({ birth_date: '1955-01-01' }), input);
    expect(amountOf(seventy, 'pension')).toBeUndefined();
    expect(amountOf(seventy, 'health')).toBe(14_775);
    const seventyFive = computeDeductions(company, person({ birth_date: '1950-01-01' }), input);
    expect(amountOf(seventyFive, 'health')).toBeUndefined();
    expect(amountOf(seventyFive, 'support')).toBeUndefined();
  });
});
