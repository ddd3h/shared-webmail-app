import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULES } from '@/lib/pay-schedule';
import { AUTO_NOTE_MARK, autoNoteSection, bonusKey, commuteTotal, DEDUCTION_TYPES, defaultPlanLabel, deductionItems, draftItems, draftPeriod, earningTotal, FIXED_PAY_TYPES, fixedKey, isCommuteLabel, isPlanDue, plansOverlap, withAutoNote } from '@/lib/fixed-pay';
import { planSchema, extraSchema } from '@/lib/fixed-pay-input';
import { isBonusTitle } from '@/lib/work';

const S = DEFAULT_SCHEDULES.executive; // 末締め・翌月25日払い
const mid = { ...S, closing_day: 15 };

describe('固定報酬が、その月に払われるか', () => {
  const plan = { starts_month: '2026-04', ends_month: '2026-09', active: true };
  it('開始月から終了月まで（両端を含む）', () => {
    expect(isPlanDue(plan, '2026-03')).toBe(false);
    expect(isPlanDue(plan, '2026-04')).toBe(true);
    expect(isPlanDue(plan, '2026-09')).toBe(true);
    expect(isPlanDue(plan, '2026-10')).toBe(false);
  });
  it('終了月が空なら続く。止めた計画は払わない', () => {
    expect(isPlanDue({ ...plan, ends_month: null }, '2030-01')).toBe(true);
    expect(isPlanDue({ ...plan, active: false }, '2026-05')).toBe(false);
  });
  it('期間が重なる計画を見つける', () => {
    expect(plansOverlap({ starts_month: '2026-01', ends_month: '2026-06' }, { starts_month: '2026-06', ends_month: null })).toBe(true);
    expect(plansOverlap({ starts_month: '2026-01', ends_month: '2026-05' }, { starts_month: '2026-06', ends_month: null })).toBe(false);
    expect(plansOverlap({ starts_month: '2026-01', ends_month: null }, { starts_month: '2030-01', ends_month: null })).toBe(true);
  });
});

describe('下書きを作る月', () => {
  it('末締め: 月末の日はその月分、それ以外の日は前の月分', () => {
    expect(draftPeriod('2026-10-31', S)).toBe('2026-10');
    expect(draftPeriod('2026-11-01', S)).toBe('2026-10');
    expect(draftPeriod('2026-11-20', S)).toBe('2026-10');
    expect(draftPeriod('2026-10-30', S)).toBe('2026-09');
  });
  it('15日締め: 10/15 に10月分、10/16〜11/14 は10月分、11/15 に11月分', () => {
    expect(draftPeriod('2026-10-15', mid)).toBe('2026-10');
    expect(draftPeriod('2026-10-16', mid)).toBe('2026-10');
    expect(draftPeriod('2026-11-14', mid)).toBe('2026-10');
    expect(draftPeriod('2026-11-15', mid)).toBe('2026-11');
  });
  it('年をまたぐ', () => {
    expect(draftPeriod('2027-01-05', S)).toBe('2026-12');
  });
});

describe('下書きの行', () => {
  it('固定の月額が先頭、加算があとに続く。どの行にも system_key は付けない（付けると明細の画面で直せなくなる）', () => {
    const items = draftItems({ label: '役員報酬', amount: 500000 }, [{ label: '通勤手当', amount: 10000 }, { label: '出張手当', amount: 5000 }]);
    expect(items.map(i => [i.label, i.amount, i.sort])).toEqual([['役員報酬', 500000, 0], ['通勤手当', 10000, 10], ['出張手当', 5000, 11]]);
    expect(items.every(i => i.system_key === null && i.kind === 'earning')).toBe(true);
  });
  it('通勤手当は固定報酬の登録から、月額のすぐ下の行になる。0 なら行を作らない', () => {
    const items = draftItems({ label: '給与', amount: 300000, commute_amount: 12000 }, [{ label: '残業手当', amount: 5000 }]);
    expect(items.map(i => [i.label, i.amount, i.sort])).toEqual([['給与', 300000, 0], ['通勤手当', 12000, 1], ['残業手当', 5000, 10]]);
    expect(draftItems({ label: '給与', amount: 300000, commute_amount: 0 }, [])).toHaveLength(1);
  });
  it('控除の行は支給のあとに、sort 100 から並ぶ', () => {
    const items = draftItems({ label: '給与', amount: 300000 }, [], [{ label: '健康保険料', amount: 14775 }, { label: '所得税（甲欄）', amount: 6340 }]);
    expect(items.slice(1).map(i => [i.kind, i.label, i.amount, i.sort, i.system_key])).toEqual([['deduction', '健康保険料', 14775, 100, null], ['deduction', '所得税（甲欄）', 6340, 101, null]]);
    expect(deductionItems([{ label: 'x', amount: 1 }], 7)[0].sort).toBe(7);
  });
  it('支給の合計は立替金の行を含めない。名前に「通勤」がある支給が非課税の通勤手当', () => {
    const rows = [
      { kind: 'earning', label: '給与', amount: 300000, system_key: null },
      { kind: 'earning', label: '通勤手当', amount: 12000, system_key: null },
      { kind: 'earning', label: '定期代（通勤）', amount: 3000, system_key: null },
      { kind: 'earning', label: '立替金精算（1件）', amount: 9999, system_key: 'expense_reimbursement' },
      { kind: 'deduction', label: '健康保険料', amount: 14775, system_key: null },
    ];
    expect(earningTotal(rows)).toBe(315000);
    expect(commuteTotal(rows)).toBe(15000);
    expect(isCommuteLabel('通勤手当')).toBe(true);
    expect(isCommuteLabel('出張手当')).toBe(false);
  });
  it('派遣は固定報酬にも控除にも入らない。準業務委託は固定報酬には入るが控除は引かない', () => {
    expect(FIXED_PAY_TYPES).toEqual(['executive', 'employee', 'regular', 'part', 'quasi_contractor']);
    expect(DEDUCTION_TYPES).toEqual(['executive', 'employee', 'regular', 'part']);
    expect(FIXED_PAY_TYPES).not.toContain('dispatch');
    expect(FIXED_PAY_TYPES).not.toContain('contractor');
    expect(['executive', 'employee', 'regular', 'part', 'quasi_contractor'].map(t => defaultPlanLabel(t as never))).toEqual(['役員報酬', '給与', '給与', '給与', '業務委託報酬']);
  });
  it('メモの【自動計算】から後ろだけを書き換える', () => {
    const section = autoNoteSection({ notes: ['標準報酬月額 300,000円'], warnings: ['生年月日が未登録です'] });
    expect(section).toBe(`${AUTO_NOTE_MARK}\n・標準報酬月額 300,000円\n⚠ 生年月日が未登録です`);
    const first = withAutoNote('下書きです。', section);
    expect(first).toBe(`下書きです。\n\n${section}`);
    expect(withAutoNote(first, `${AUTO_NOTE_MARK}\n・新しい`)).toBe(`下書きです。\n\n${AUTO_NOTE_MARK}\n・新しい`);
    expect(withAutoNote(first, null)).toBe('下書きです。');
    expect(withAutoNote(null, section)).toBe(section);
    expect(withAutoNote('x', 'y'.repeat(2000)).length).toBeLessThanOrEqual(990);
  });
  it('加算がなければ、月額の1行だけ', () => {
    expect(draftItems({ label: '業務委託報酬', amount: 300000 }, [])).toHaveLength(1);
  });
  it('二重作成を止める鍵は、人と月・賞与ごとに決まる', () => {
    expect(fixedKey('u1', '2026-10')).toBe('fixed:u1:2026-10');
    expect(bonusKey('x9')).toBe('bonus:x9');
  });
});

describe('賞与の題名', () => {
  it('「賞与」を含む題名が賞与', () => {
    expect(isBonusTitle('賞与')).toBe(true);
    expect(isBonusTitle('役員賞与')).toBe(true);
    expect(isBonusTitle('賞与（夏季）')).toBe(true);
    expect(isBonusTitle('給与')).toBe(false);
    expect(isBonusTitle('役員報酬')).toBe(false);
    expect(isBonusTitle('立替金精算')).toBe(false);
  });
});

describe('API が受け取る形', () => {
  const base = { user_id: 'u1', label: '役員報酬', amount: 500000, starts_month: '2026-04' };
  it('正しい計画を受け付ける', () => {
    expect(planSchema.safeParse(base).success).toBe(true);
    expect(planSchema.safeParse({ ...base, ends_month: '2026-12' }).success).toBe(true);
  });
  it('金額・月・期間の向きが不正なら受け付けない', () => {
    expect(planSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, amount: 1.5 }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, starts_month: '2026-13' }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, ends_month: '2026-03' }).success).toBe(false);
  });
  it('固定報酬の名前に「賞与」は使えない（賞与の明細と取り違えるため）', () => {
    expect(planSchema.safeParse({ ...base, label: '役員賞与' }).success).toBe(false);
  });
  it('加算・賞与', () => {
    const ex = { user_id: 'u1', pay_month: '2026-10', kind: 'bonus', label: '夏季賞与', amount: 100000 };
    expect(extraSchema.safeParse(ex).success).toBe(true);
    expect(extraSchema.safeParse({ ...ex, kind: 'other' }).success).toBe(false);
    expect(extraSchema.safeParse({ ...ex, amount: -1 }).success).toBe(false);
  });
});
