import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULE, DEFAULT_SCHEDULES, addMonths, closingDate, describeSchedule, expenseDeadline, isValidSchedule, payDate, periodOf, periodStart, planFor, reportDeadline, shortDate, type PaySchedule } from '@/lib/pay-schedule';

const s = (o: Partial<PaySchedule> = {}): PaySchedule => ({ ...DEFAULT_SCHEDULE, ...o });

describe('締め日・振込日', () => {
  it('末日締め・翌月25日払い: 10月分は 10/31 に締め、11/25 に払う（日曜は前の金曜に）', () => {
    expect(closingDate('2026-10', s())).toBe('2026-10-31');
    expect(payDate('2026-10', s({ pay_day_shift: 'none' }))).toBe('2026-11-25');
    expect(shortDate('2026-11-25')).toBe('11/25(水)');
    // 2026-12-25 is a Friday, 2027-01-25 a Monday, 2026-12-26 a Saturday
    expect(payDate('2026-11', s())).toBe('2026-12-25');
    expect(payDate('2026-11', s({ pay_day: 26, pay_day_shift: 'before' }))).toBe('2026-12-25');
    expect(payDate('2026-11', s({ pay_day: 26, pay_day_shift: 'after' }))).toBe('2026-12-28');
    expect(payDate('2026-11', s({ pay_day: 26, pay_day_shift: 'none' }))).toBe('2026-12-26');
    expect(payDate('2026-11', s({ pay_day: 27, pay_day_shift: 'before' }))).toBe('2026-12-25'); // Sunday -> the Friday
    expect(payDate('2026-11', s({ pay_day: 27, pay_day_shift: 'after' }))).toBe('2026-12-28');
  });
  it('月末は月によって変わる。うるう年も', () => {
    expect(closingDate('2026-02', s())).toBe('2026-02-28');
    expect(closingDate('2028-02', s())).toBe('2028-02-29');
    expect(closingDate('2026-04', s())).toBe('2026-04-30');
    expect(payDate('2026-01', s({ pay_month_offset: 1, pay_day: 0, pay_day_shift: 'none' }))).toBe('2026-02-28');
  });
  it('15日締めは、前の期間の翌日から。月をまたぐ日付は次の期間', () => {
    const x = s({ closing_day: 15 });
    expect(closingDate('2026-10', x)).toBe('2026-10-15');
    expect(periodStart('2026-10', x)).toBe('2026-09-16');
    expect(periodOf('2026-10-15', x)).toBe('2026-10');
    expect(periodOf('2026-10-16', x)).toBe('2026-11');
    expect(periodOf('2026-12-20', x)).toBe('2027-01');
    expect(periodOf('2026-10-31', s())).toBe('2026-10');
    expect(periodStart('2026-10', s())).toBe('2026-10-01');
  });
  it('支払月: 当月・翌月・翌々月。年をまたぐ', () => {
    expect(payDate('2026-12', s({ pay_month_offset: 0, pay_day: 20, pay_day_shift: 'none' }))).toBe('2026-12-20');
    expect(payDate('2026-12', s({ pay_month_offset: 1, pay_day: 10, pay_day_shift: 'none' }))).toBe('2027-01-10');
    expect(payDate('2026-12', s({ pay_month_offset: 2, pay_day: 10, pay_day_shift: 'none' }))).toBe('2027-02-10');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('期限: 締め日の○日後。期限までに出せばその期間、過ぎたら次の期間（1回分遅れる）', () => {
    expect(reportDeadline('2026-10', s({ report_deadline_days: 5 }))).toBe('2026-11-05');
    expect(expenseDeadline('2026-10', s({ expense_deadline_days: 0 }))).toBe('2026-10-31');
    const x = s({ pay_day_shift: 'none' });
    expect(planFor('2026-10-20', '2026-10-21', x, 'expense')).toEqual({ period: '2026-10', closing_date: '2026-10-31', deadline: '2026-11-05', pay_date: '2026-11-25', late: false });
    expect(planFor('2026-10-20', '2026-11-05', x, 'expense').late).toBe(false);   // the deadline day itself is still in time
    expect(planFor('2026-10-20', '2026-11-06', x, 'expense')).toMatchObject({ period: '2026-11', pay_date: '2026-12-25', late: true });
    expect(planFor('2026-10-20', '2026-12-30', x, 'report')).toMatchObject({ period: '2026-12', late: true });   // several cycles late
    expect(planFor('2026-10-20', '2026-10-20', s({ report_deadline_days: 0, pay_day_shift: 'none' }), 'report').late).toBe(false);
  });
  it('設定の検証と表示', () => {
    expect(isValidSchedule(s())).toBe(true);
    for (const bad of [{ closing_day: 29 }, { closing_day: -1 }, { pay_month_offset: 3 }, { pay_day: 31 }, { pay_day_shift: 'x' as never }, { report_deadline_days: 32 }, { expense_deadline_days: 1.5 }]) expect(isValidSchedule(s(bad)), JSON.stringify(bad)).toBe(false);
    expect(describeSchedule(s())).toBe('末日締め・翌月25日払い');
    expect(describeSchedule(s({ closing_day: 15, pay_month_offset: 0, pay_day: 0 }))).toBe('15日締め・当月末日払い');
    expect(describeSchedule(DEFAULT_SCHEDULES.contractor)).toBe('末日締め・翌月末日払い');
  });
});
