// 業務報告書: 準業務委託は、1期間（締め日で区切った月）に1通でよい。pure（I/Oなし）。
import { closingDate, periodOf, periodStart, type PaySchedule } from '@/lib/pay-schedule';
import { type WorkerType } from '@/lib/work';

/** 準業務委託 reports once per period (a month); 業務委託 may hand in as many as they like. */
export const oneReportPerPeriod = (t: WorkerType) => t === 'quasi_contractor';

/** The first and last day of the period a report date falls in, and the period's name ('YYYY-MM'). */
export function periodSpan(reportDate: string, s: PaySchedule): { period: string; start: string; end: string } {
  const period = periodOf(reportDate, s);
  return { period, start: periodStart(period, s), end: closingDate(period, s) };
}

export type ReportRow = {
  id: string; user_id: string; report_date: string; title: string; content: string; hours: number | null;
  activity_flag: boolean; activity_note: string | null; created_at: Date;
};
export type Merged = {
  keep_id: string; remove_ids: string[]; report_date: string; title: string; content: string; hours: number | null;
  activity_flag: boolean; activity_note: string | null;
};

/** Several reports of one period become one: the oldest record is kept (so the day it was handed in stays), dated with the last day reported;
 *  every report goes into the text under its own date and title, so nothing is lost; hours add up; a warning mark stays. */
export function mergeReports(period: string, rows: ReportRow[]): Merged {
  const byDate = [...rows].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.created_at.getTime() - b.created_at.getTime());
  const keep = [...rows].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))[0];
  const withHours = rows.filter(r => r.hours !== null);
  const notes = [...new Set(rows.flatMap(r => (r.activity_flag && r.activity_note ? [r.activity_note] : [])))];
  return {
    keep_id: keep.id,
    remove_ids: rows.filter(r => r.id !== keep.id).map(r => r.id),
    report_date: byDate[byDate.length - 1].report_date,
    title: `${Number(period.slice(5))}月分 業務報告`,
    content: byDate.map(r => `■ ${r.report_date} ${r.title}\n${r.content}`).join('\n\n'),
    hours: withHours.length === 0 ? null : Math.round(withHours.reduce((s, r) => s + (r.hours ?? 0), 0) * 100) / 100,
    activity_flag: rows.some(r => r.activity_flag),
    activity_note: notes.length === 0 ? null : notes.join(' / '),
  };
}
