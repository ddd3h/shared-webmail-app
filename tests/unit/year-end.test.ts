import { describe, it, expect } from 'vitest';
import { ageAtYearEnd, blankDependent, blankPerson, blankYearEnd, dependentHint, hasYearEnd, isValidYear, spouseHint, submitProblems, yearEndCsv, yearEndSchema, CSV_HEADER } from '@/lib/year-end';

const person = (o: Partial<ReturnType<typeof blankPerson>> = {}) => ({ ...blankPerson(), name: '佐藤花子', birth_date: '1990-04-01', income_estimate: 0, ...o });

describe('年末調整: だれが出すか・年', () => {
  it('給与をもらう人と役員が出す。派遣・業務委託・準業務委託は出さない', () => {
    expect((['employee', 'regular', 'part', 'executive'] as const).map(t => hasYearEnd(t))).toEqual([true, true, true, true]);
    expect((['dispatch', 'contractor', 'quasi_contractor'] as const).map(t => hasYearEnd(t))).toEqual([false, false, false]);
  });
  it('年は2020〜2100の整数', () => {
    expect([2020, 2026, 2100].every(isValidYear)).toBe(true);
    expect([2019, 2101, 2026.5, NaN].some(isValidYear)).toBe(false);
  });
});

describe('年末調整: 入力の形', () => {
  it('空の申告書は正しい形', () => { expect(yearEndSchema.safeParse(blankYearEnd()).success).toBe(true); });
  it('下書きは空の氏名・生年月日でも保存できるが、日付の形が違えば拒否する', () => {
    const d = { ...blankYearEnd(), spouse: blankPerson() };
    expect(yearEndSchema.safeParse(d).success).toBe(true);
    expect(yearEndSchema.safeParse({ ...d, spouse: { ...blankPerson(), birth_date: '2026-02-30' } }).success).toBe(false);
  });
  it('金額は0以上の整数。扶養親族は10人まで', () => {
    expect(yearEndSchema.safeParse({ ...blankYearEnd(), deductions: { ...blankYearEnd().deductions, life_insurance: -1 } }).success).toBe(false);
    expect(yearEndSchema.safeParse({ ...blankYearEnd(), deductions: { ...blankYearEnd().deductions, life_insurance: 1.5 } }).success).toBe(false);
    expect(yearEndSchema.safeParse({ ...blankYearEnd(), dependents: Array.from({ length: 10 }, blankDependent) }).success).toBe(true);
    expect(yearEndSchema.safeParse({ ...blankYearEnd(), dependents: Array.from({ length: 11 }, blankDependent) }).success).toBe(false);
  });
  it('提出には、家族の氏名・生年月日・所得と、前職の会社名が要る', () => {
    expect(submitProblems(blankYearEnd())).toEqual([]);
    const d = { ...blankYearEnd(), spouse: blankPerson(), dependents: [blankDependent()], previous_job: { ...blankYearEnd().previous_job, has: true } };
    expect(submitProblems(d)).toEqual(['spouse.name', 'spouse.birth_date', 'spouse.income_estimate', 'dependents.0.name', 'dependents.0.birth_date', 'dependents.0.income_estimate', 'previous_job.company']);
    expect(submitProblems({ ...d, spouse: person(), dependents: [{ ...person(), relation: 'child' as const }], previous_job: { ...d.previous_job, company: '株式会社A' } })).toEqual([]);
  });
});

describe('年末調整: 目安の判定', () => {
  it('年齢は、その年の12月31日の時点', () => {
    expect(ageAtYearEnd('2010-12-31', 2026)).toBe(16);
    expect(ageAtYearEnd('2026-01-01', 2026)).toBe(0);
    expect(ageAtYearEnd('2027-01-01', 2026)).toBeNull();
    expect(ageAtYearEnd('', 2026)).toBeNull();
  });
  it('配偶者: 所得58万円以下は配偶者控除、133万円以下は配偶者特別控除、超えると対象外', () => {
    expect(spouseHint(person({ income_estimate: 580_000 }))).toContain('配偶者控除');
    expect(spouseHint(person({ income_estimate: 580_000 }))).not.toContain('特別');
    expect(spouseHint(person({ income_estimate: 580_001 }))).toContain('配偶者特別控除');
    expect(spouseHint(person({ income_estimate: 1_330_000 }))).toContain('配偶者特別控除');
    expect(spouseHint(person({ income_estimate: 1_330_001 }))).toContain('対象外');
    expect(spouseHint(person({ income_estimate: null }))).toContain('入れると');
  });
  const dep = (birth: string, income: number | null, o = {}) => ({ ...person({ birth_date: birth, income_estimate: income }), relation: 'child' as const, ...o });
  it('扶養親族: 16歳未満・一般・特定（19〜22）・老人（70〜）に分ける', () => {
    expect(dependentHint(dep('2012-05-01', 0), 2026)).toContain('16歳未満');
    expect(dependentHint(dep('2008-05-01', 0), 2026)).toContain('一般');       // 18
    expect(dependentHint(dep('2006-05-01', 0), 2026)).toContain('特定扶養親族'); // 20
    expect(dependentHint(dep('1990-05-01', 0), 2026)).toContain('一般');
    expect(dependentHint(dep('1950-05-01', 0, { relation: 'parent' }), 2026)).toContain('同居老親等');
    expect(dependentHint(dep('1950-05-01', 0, { relation: 'parent', cohabiting: false }), 2026)).not.toContain('同居老親等');
  });
  it('扶養親族: 所得が58万円を超えると対象外。ただし19〜22歳は123万円まで特定親族特別控除', () => {
    expect(dependentHint(dep('1990-05-01', 580_001), 2026)).toContain('対象外');
    expect(dependentHint(dep('2006-05-01', 900_000), 2026)).toContain('特定親族特別控除');
    expect(dependentHint(dep('2006-05-01', 1_230_001), 2026)).toContain('対象外');
  });
  it('日付や所得が空なら、入れるよう案内する', () => {
    expect(dependentHint(dep('', 0), 2026)).toContain('生年月日');
    expect(dependentHint(dep('1990-05-01', null), 2026)).toContain('所得');
  });
});

describe('年末調整: CSV', () => {
  const data = { ...blankYearEnd(), spouse: person({ income_estimate: 400_000 }), dependents: [{ ...person({ name: '佐藤一郎', birth_date: '2015-03-03' }), relation: 'child' as const }], deductions: { ...blankYearEnd().deductions, life_insurance: 50_000, housing_loan: true }, note: '=1+1' };
  const csv = yearEndCsv([
    { name: '佐藤', worker_type: '正社員', status: 'submitted', data, submitted_at: null, confirmed_at: null },
    { name: '鈴木', worker_type: '役員', status: 'none', data: null, submitted_at: null, confirmed_at: null },
  ]);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  it('Excelで文字化けしないBOM付きで、見出し・提出者・未入力の人が並ぶ', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines[1]).toContain('佐藤,正社員,提出済み');
    expect(lines[1]).toContain('子: 佐藤一郎（2015-03-03');
    expect(lines[2].startsWith('鈴木,役員,未入力,')).toBe(true);
    expect(lines[2].split(',')).toHaveLength(CSV_HEADER.length);
  });
  it('= で始まる文字は、表計算で式として動かないようにする', () => { expect(lines[1]).toContain(`'=1+1`); });
});
