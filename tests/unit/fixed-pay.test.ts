import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULES } from '@/lib/pay-schedule';
import { ADDON_PREFIX, bonusKey, draftItems, draftPeriod, fixedKey, isPlanDue, plansOverlap } from '@/lib/fixed-pay';
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
  it('固定の月額が先頭、加算は system_key つきであとに続く', () => {
    const items = draftItems({ label: '役員報酬', amount: 500000 }, [{ id: 'a1', label: '通勤手当', amount: 10000 }, { id: 'a2', label: '出張手当', amount: 5000 }]);
    expect(items.map(i => [i.label, i.amount, i.sort])).toEqual([['役員報酬', 500000, 0], ['通勤手当', 10000, 10], ['出張手当', 5000, 11]]);
    expect(items[0].system_key).toBeNull();
    expect(items[1].system_key).toBe(`${ADDON_PREFIX}a1`);
    expect(items.every(i => i.kind === 'earning')).toBe(true);
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
