import { describe, it, expect } from 'vitest';
import {
  allowedPunches, isValidDateString, isValidMonth, jstDateString, monthRange, payslipTotals, summarizeMonth, workedMinutes,
} from '@/lib/work';

const at = (s: string) => new Date(s);

describe('jstDateString', () => {
  it('UTCの夕方は日本時間では翌日になる', () => {
    expect(jstDateString(at('2026-10-19T16:30:00Z'))).toBe('2026-10-20');
    expect(jstDateString(at('2026-10-19T14:59:00Z'))).toBe('2026-10-19');
  });
});

describe('validation', () => {
  it('日付と月の形式を検証する', () => {
    expect(isValidDateString('2026-02-28')).toBe(true);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidMonth('2026-12')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
  });
  it('monthRangeは月初〜翌月初', () => {
    const { start, end } = monthRange('2026-12');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('workedMinutes', () => {
  const day = (brk: number) => ({ clock_in_at: at('2026-10-20T00:00:00Z'), clock_out_at: at('2026-10-20T09:00:00Z'), break_minutes: brk });
  it('打刻した休憩を引く', () => {
    expect(workedMinutes(day(45))).toBe(540 - 45);
  });
  it('休憩の打刻がない長時間勤務は自動休憩を引く', () => {
    expect(workedMinutes(day(0), 60)).toBe(480);
  });
  it('短時間勤務には自動休憩を引かない', () => {
    expect(workedMinutes({ clock_in_at: at('2026-10-20T00:00:00Z'), clock_out_at: at('2026-10-20T04:00:00Z'), break_minutes: 0 }, 60)).toBe(240);
  });
  it('退勤前はnull', () => {
    expect(workedMinutes({ clock_in_at: at('2026-10-20T00:00:00Z'), clock_out_at: null, break_minutes: 0 })).toBeNull();
  });
});

describe('summarizeMonth', () => {
  it('日数・合計・残業を集計し、未退勤の日は除く', () => {
    const rows = [
      { clock_in_at: at('2026-10-19T00:00:00Z'), clock_out_at: at('2026-10-19T10:00:00Z'), break_minutes: 60 }, // 540
      { clock_in_at: at('2026-10-20T00:00:00Z'), clock_out_at: at('2026-10-20T08:00:00Z'), break_minutes: 60 }, // 420
      { clock_in_at: at('2026-10-21T00:00:00Z'), clock_out_at: null, break_minutes: 0 },
    ];
    expect(summarizeMonth(rows, 480)).toEqual({ days: 2, workedMinutes: 960, overtimeMinutes: 60 });
  });
});

describe('allowedPunches', () => {
  it('状態に応じて押せる打刻が変わる', () => {
    expect(allowedPunches(null)).toEqual(['clock_in']);
    const base = { clock_in_at: at('2026-10-20T00:00:00Z'), clock_out_at: null, break_started_at: null };
    expect(allowedPunches(base)).toEqual(['break_start', 'clock_out']);
    expect(allowedPunches({ ...base, break_started_at: at('2026-10-20T03:00:00Z') })).toEqual(['break_end']);
    expect(allowedPunches({ ...base, clock_out_at: at('2026-10-20T09:00:00Z') })).toEqual([]);
  });
});

describe('payslipTotals', () => {
  it('手取り=支給−控除', () => {
    expect(payslipTotals([
      { kind: 'earning', amount: 300000 }, { kind: 'earning', amount: 20000 }, { kind: 'deduction', amount: 45000 },
    ])).toEqual({ earnings: 320000, deductions: 45000, net: 275000 });
  });
});

import { WORKER_TYPES, WORKER_TYPE_LABEL, isContractorLike, paysSalary, usesAttendance, usesReports } from '@/lib/work';
import { DEFAULT_SCHEDULES, describeSchedule } from '@/lib/pay-schedule';

describe('区分ごとに使える機能', () => {
  it('準業務委託は、業務委託と同じく報告書を出し、報酬明細で、打刻はしない', () => {
    expect(WORKER_TYPE_LABEL.quasi_contractor).toBe('準業務委託');
    expect([usesAttendance('quasi_contractor'), usesReports('quasi_contractor'), paysSalary('quasi_contractor'), isContractorLike('quasi_contractor')]).toEqual([false, true, false, true]);
    expect([usesAttendance('contractor'), usesReports('contractor'), paysSalary('contractor'), isContractorLike('contractor')]).toEqual([false, true, false, true]);
  });
  it('どの区分にも、表示名と締め日・振込日の初期値がある', () => {
    for (const t of WORKER_TYPES) {
      expect(WORKER_TYPE_LABEL[t], t).toBeTruthy();
      expect(describeSchedule(DEFAULT_SCHEDULES[t]), t).toMatch(/締め・/);
    }
    expect(describeSchedule(DEFAULT_SCHEDULES.quasi_contractor)).toBe('末日締め・翌月末日払い');
  });
});
