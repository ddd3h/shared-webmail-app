// 締め日・振込日 (pure helpers; the settings live in the pay_schedules table, see pay-schedule-server.ts).
//
// A "period" is named by its closing month, like the pay month of a statement: with the closing day 15, the 10月分 covers 9/16-10/15.
// Its pay date is the pay day of the closing month plus `pay_month_offset` months (末締め翌月25日払い: 10月分 is paid on 11/25).
// Dates are 'YYYY-MM-DD' strings (Japan time) and months 'YYYY-MM'. Public holidays are not known here: only weekends move a pay day.
import type { WorkerType } from '@/lib/work';

export type PayDayShift = 'before' | 'after' | 'none';
export type PaySchedule = {
  closing_day: number;           // 0 = the last day of the month, otherwise 1-28
  pay_month_offset: number;      // 0 = the closing month, 1 = the next, 2 = the one after
  pay_day: number;               // 0 = the last day, otherwise 1-28
  pay_day_shift: PayDayShift;    // a Saturday/Sunday pay day moves to the Friday before, the Monday after, or stays
  report_deadline_days: number;  // 業務報告書: days after the closing day it may still be handed in for that period
  expense_deadline_days: number; // 経費: same
};

export const DEFAULT_SCHEDULE: PaySchedule = { closing_day: 0, pay_month_offset: 1, pay_day: 25, pay_day_shift: 'before', report_deadline_days: 5, expense_deadline_days: 5 };
/** 業務委託 and 準業務委託 are usually paid at the end of the next month. */
export const DEFAULT_SCHEDULES: Record<WorkerType, PaySchedule> = {
  executive: DEFAULT_SCHEDULE, regular: DEFAULT_SCHEDULE, part: DEFAULT_SCHEDULE, dispatch: DEFAULT_SCHEDULE, employee: DEFAULT_SCHEDULE,
  contractor: { ...DEFAULT_SCHEDULE, pay_day: 0 },
  quasi_contractor: { ...DEFAULT_SCHEDULE, pay_day: 0 },
};

export function isValidSchedule(s: PaySchedule): boolean {
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  return int(s.closing_day, 0, 28) && int(s.pay_month_offset, 0, 2) && int(s.pay_day, 0, 28)
    && ['before', 'after', 'none'].includes(s.pay_day_shift) && int(s.report_deadline_days, 0, 31) && int(s.expense_deadline_days, 0, 31);
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const parseMonth = (ym: string) => ({ y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)) });

export function addMonths(ym: string, n: number): string {
  const { y, m } = parseMonth(ym);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

function dayOfMonth(ym: string, day: number): string {
  const { y, m } = parseMonth(ym);
  const last = lastDay(y, m);
  return `${ym}-${pad(day === 0 ? last : Math.min(day, last))}`;
}

/** The closing date of a period ('2026-10' -> '2026-10-31', or '2026-10-15' with the closing day 15). */
export const closingDate = (period: string, s: PaySchedule) => dayOfMonth(period, s.closing_day);

/** First day of a period: the day after the previous period closed. */
export const periodStart = (period: string, s: PaySchedule) => addDays(closingDate(addMonths(period, -1), s), 1);

/** The period (closing month) a date falls in. */
export function periodOf(date: string, s: PaySchedule): string {
  const ym = date.slice(0, 7);
  return date <= closingDate(ym, s) ? ym : addMonths(ym, 1);
}

/** The day the period is paid: moved off a weekend as the schedule says. */
export function payDate(period: string, s: PaySchedule): string {
  const raw = dayOfMonth(addMonths(period, s.pay_month_offset), s.pay_day);
  const wd = weekday(raw);
  if (s.pay_day_shift === 'none' || (wd !== 0 && wd !== 6)) return raw;
  if (s.pay_day_shift === 'before') return addDays(raw, wd === 6 ? -1 : -2);
  return addDays(raw, wd === 6 ? 2 : 1);
}

export const reportDeadline = (period: string, s: PaySchedule) => addDays(closingDate(period, s), s.report_deadline_days);
export const expenseDeadline = (period: string, s: PaySchedule) => addDays(closingDate(period, s), s.expense_deadline_days);

export type Plan = { period: string; closing_date: string; deadline: string; pay_date: string; late: boolean };

/**
 * Which period a thing handed in on `submitted` counts in, and when it is paid.
 * `happened` is the day it is about (the expense date, the report date). Handed in after the deadline of its own period,
 * it moves on to the next period (`late`): the person gets paid one cycle later.
 */
export function planFor(happened: string, submitted: string, s: PaySchedule, kind: 'report' | 'expense'): Plan {
  const deadlineOf = kind === 'report' ? reportDeadline : expenseDeadline;
  let period = periodOf(happened, s);
  let late = false;
  for (let i = 0; i < 24 && submitted > deadlineOf(period, s); i++) { period = addMonths(period, 1); late = true; }
  return { period, closing_date: closingDate(period, s), deadline: deadlineOf(period, s), pay_date: payDate(period, s), late };
}

/** The period that is open on `today`: the one whose closing date has not passed yet. */
export const currentPeriod = (today: string, s: PaySchedule) => periodOf(today, s);

/** "11/25(火)" */
export function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${'日月火水木金土'[weekday(date)]})`;
}
/** "毎月末日" / "毎月15日" */
export const dayLabel = (d: number) => (d === 0 ? '末日' : `${d}日`);
export const OFFSET_LABEL = ['当月', '翌月', '翌々月'] as const;
export const SHIFT_LABEL: Record<PayDayShift, string> = { before: '前の平日に早める', after: '次の平日に遅らせる', none: 'そのまま' };

/** "末日締め・翌月25日払い" */
export const describeSchedule = (s: PaySchedule) => `${dayLabel(s.closing_day)}締め・${OFFSET_LABEL[s.pay_month_offset]}${dayLabel(s.pay_day)}払い`;
