import { describe, it, expect } from 'vitest';
import { computeLines, datesOverlap, linesTotal, quantityFor, tripDays, tripNights, validateSelection, withinTrip, type AllowanceType } from '@/lib/trip';

const t = (o: Partial<AllowanceType> & { id: string }): AllowanceType => ({ name: o.id, kind: 'addon', unit: 'per_day', amount: 1000, ...o });

describe('日数と泊数', () => {
  it('開始日と終了日を含めて数える', () => {
    expect(tripDays('2026-10-28', '2026-10-30')).toBe(3);
    expect(tripNights('2026-10-28', '2026-10-30')).toBe(2);
  });
  it('日帰りは1日0泊', () => {
    expect(tripDays('2026-10-28', '2026-10-28')).toBe(1);
    expect(tripNights('2026-10-28', '2026-10-28')).toBe(0);
  });
  it('月またぎ・年またぎ・うるう日も正しく数える', () => {
    expect(tripDays('2026-10-30', '2026-11-02')).toBe(4);
    expect(tripDays('2026-12-30', '2027-01-02')).toBe(4);
    expect(tripDays('2028-02-28', '2028-03-01')).toBe(3);
  });
  it('単位ごとの数量', () => {
    expect(quantityFor('per_day', '2026-10-28', '2026-10-30')).toBe(3);
    expect(quantityFor('per_night', '2026-10-28', '2026-10-30')).toBe(2);
    expect(quantityFor('per_trip', '2026-10-28', '2026-10-30')).toBe(1);
  });
});

describe('computeLines', () => {
  const daily = t({ id: 'd', kind: 'daily', unit: 'per_day', amount: 3000 });
  const night = t({ id: 'n', unit: 'per_night', amount: 2000 });
  const flat = t({ id: 'f', unit: 'per_trip', amount: 5000 });
  const day = t({ id: 'a', unit: 'per_day', amount: 1000 });

  it('日当・加算金をそれぞれの単位で計算して合計する', () => {
    const lines = computeLines([day, night, flat, daily], '2026-10-28', '2026-10-30');
    expect(lines.map(l => [l.name, l.quantity, l.amount])).toEqual([['d', 3, 9000], ['a', 3, 3000], ['n', 2, 4000], ['f', 1, 5000]]);
    expect(linesTotal(lines)).toBe(21000);
  });
  it('日当が先に並ぶ', () => {
    expect(computeLines([flat, daily], '2026-10-28', '2026-10-28')[0].kind).toBe('daily');
  });
  it('日帰りでは1泊あたりの手当は0円', () => {
    expect(computeLines([night], '2026-10-28', '2026-10-28')[0].amount).toBe(0);
  });
  it('選択なしなら空', () => {
    expect(computeLines([], '2026-10-28', '2026-10-30')).toEqual([]);
  });
});

describe('選択の検証', () => {
  it('日当は1つまで', () => {
    expect(validateSelection([{ kind: 'daily' }, { kind: 'daily' }])).toBe('multiple_daily');
    expect(validateSelection([{ kind: 'daily' }, { kind: 'addon' }, { kind: 'addon' }])).toBeNull();
  });
});

describe('期間', () => {
  it('重なりを判定する（境界日も重なり）', () => {
    expect(datesOverlap('2026-10-28', '2026-10-30', '2026-10-30', '2026-11-01')).toBe(true);
    expect(datesOverlap('2026-10-28', '2026-10-30', '2026-10-31', '2026-11-01')).toBe(false);
    expect(datesOverlap('2026-10-01', '2026-10-31', '2026-10-10', '2026-10-11')).toBe(true);
  });
  it('出張期間内かどうか', () => {
    expect(withinTrip('2026-10-28', '2026-10-28', '2026-10-30')).toBe(true);
    expect(withinTrip('2026-10-27', '2026-10-28', '2026-10-30')).toBe(false);
  });
});
