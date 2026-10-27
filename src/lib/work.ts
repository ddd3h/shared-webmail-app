// Pure helpers for attendance / reports / payslips (no I/O so they are easy to test).

export type WorkerType = 'executive' | 'regular' | 'part' | 'dispatch' | 'employee' | 'contractor' | 'quasi_contractor';

export const WORKER_TYPES: WorkerType[] = ['executive', 'regular', 'part', 'dispatch', 'employee', 'contractor', 'quasi_contractor'];

export const WORKER_TYPE_LABEL: Record<WorkerType, string> = {
  executive: '役員',
  regular: '正社員',
  part: 'パート',
  dispatch: '派遣',
  // the first kind this app had: kept as it is so nobody's record changes meaning ("従業員" = works in-house, no finer split)
  employee: '従業員',
  contractor: '業務委託',
  quasi_contractor: '準業務委託', // 準委任契約: works for a period (hours), not for a result; reports like 業務委託
};

// What each kind may use. Everyone but 役員 and 業務委託 clocks in; 役員, 派遣 and 業務委託 get a 報酬 statement rather than a 給与 one
// (a dispatched worker is paid by the agency, so what this company pays is a fee).
export const usesAttendance = (t: WorkerType) => t === 'employee' || t === 'regular' || t === 'part' || t === 'dispatch';
export const usesReports = (t: WorkerType) => t === 'contractor' || t === 'quasi_contractor';
/** Paid a 業務委託費 (a fee) under a contract rather than a salary: 業務委託 and 準業務委託. */
export const isContractorLike = (t: WorkerType) => t === 'contractor' || t === 'quasi_contractor';
export const paysSalary = (t: WorkerType) => t === 'employee' || t === 'regular' || t === 'part';

export const DEFAULT_DAILY_MINUTES = 480;
export const DEFAULT_AUTO_BREAK_MINUTES = 60;
// Auto break only kicks in for shifts at least this long.
const AUTO_BREAK_THRESHOLD_MIN = 360;

const JST_OFFSET_MS = 9 * 3600_000;

// 'YYYY-MM-DD' of the Japan-local date of an instant.
export function jstDateString(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime())
    && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

export function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

// Date-only columns are stored as UTC midnight.
export function toDbDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

// [start, end) of a 'YYYY-MM' month as date-only values.
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export type AttendanceLike = {
  clock_in_at: Date | null;
  clock_out_at: Date | null;
  break_minutes: number;
};

// Worked minutes of a finished day, or null while the day is still open.
// If no break was recorded on a long shift, the configured automatic break is deducted.
export function workedMinutes(r: AttendanceLike, autoBreakMinutes = 0): number | null {
  if (!r.clock_in_at || !r.clock_out_at) return null;
  const total = Math.floor((r.clock_out_at.getTime() - r.clock_in_at.getTime()) / 60_000);
  if (total < 0) return null;
  const brk = r.break_minutes > 0
    ? r.break_minutes
    : total >= AUTO_BREAK_THRESHOLD_MIN ? autoBreakMinutes : 0;
  return Math.max(0, total - brk);
}

export function summarizeMonth(records: AttendanceLike[], dailyMinutes: number, autoBreakMinutes = 0) {
  let days = 0, worked = 0, overtime = 0;
  for (const r of records) {
    const w = workedMinutes(r, autoBreakMinutes);
    if (w === null) continue;
    days++;
    worked += w;
    overtime += Math.max(0, w - dailyMinutes);
  }
  return { days, workedMinutes: worked, overtimeMinutes: overtime };
}

export type PunchAction = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

export type PunchState = {
  clock_in_at: Date | null;
  clock_out_at: Date | null;
  break_started_at: Date | null;
} | null;

// Which punches make sense right now.
export function allowedPunches(r: PunchState): PunchAction[] {
  if (!r || !r.clock_in_at) return ['clock_in'];
  if (r.clock_out_at) return [];
  if (r.break_started_at) return ['break_end'];
  return ['break_start', 'clock_out'];
}

export function payslipTotals(items: { kind: string; amount: number }[]) {
  let earnings = 0, deductions = 0;
  for (const i of items) {
    if (i.kind === 'earning') earnings += i.amount;
    else if (i.kind === 'deduction') deductions += i.amount;
  }
  return { earnings, deductions, net: earnings - deductions };
}
