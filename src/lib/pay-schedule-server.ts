// DB side of 締め日・振込日: read the schedule of a kind of worker (the defaults when none was saved), and save one.
import { prisma } from '@/lib/db';
import { DEFAULT_SCHEDULES, isValidSchedule, planFor, type PayDayShift, type PaySchedule, type Plan } from '@/lib/pay-schedule';
import { WORKER_TYPES, jstDateString, type WorkerType } from '@/lib/work';

type Row = { worker_type: WorkerType; closing_day: number; pay_month_offset: number; pay_day: number; pay_day_shift: string; report_deadline_days: number; expense_deadline_days: number };

const fromRow = (r: Row): PaySchedule => {
  const s: PaySchedule = { closing_day: r.closing_day, pay_month_offset: r.pay_month_offset, pay_day: r.pay_day, pay_day_shift: r.pay_day_shift as PayDayShift, report_deadline_days: r.report_deadline_days, expense_deadline_days: r.expense_deadline_days };
  return isValidSchedule(s) ? s : DEFAULT_SCHEDULES[r.worker_type]; // a row nobody should have been able to save: fall back rather than compute nonsense
};

/** Every kind of worker's schedule, and which of them were set by hand (the others use the defaults). */
export async function loadSchedules(): Promise<{ schedules: Record<WorkerType, PaySchedule>; custom: Set<WorkerType> }> {
  const rows = await prisma.pay_schedules.findMany();
  const schedules = { ...DEFAULT_SCHEDULES };
  const custom = new Set<WorkerType>();
  for (const r of rows) { schedules[r.worker_type as WorkerType] = fromRow(r as Row); custom.add(r.worker_type as WorkerType); }
  return { schedules, custom };
}

export async function loadSchedule(type: WorkerType): Promise<PaySchedule> {
  const row = await prisma.pay_schedules.findUnique({ where: { worker_type: type } });
  return row ? fromRow(row as Row) : DEFAULT_SCHEDULES[type];
}

export async function saveSchedule(type: WorkerType, s: PaySchedule, userId: string) {
  await prisma.pay_schedules.upsert({ where: { worker_type: type }, create: { worker_type: type, ...s, updated_by_id: userId }, update: { ...s, updated_by_id: userId } });
}

export const isWorkerType = (v: string): v is WorkerType => (WORKER_TYPES as string[]).includes(v);

/** When something handed in is paid (see planFor). `submitted` is the moment it was created; the day is Japan time. */
export const planOf = (schedules: Record<WorkerType, PaySchedule>, type: WorkerType, happened: Date, submitted: Date, kind: 'report' | 'expense'): Plan =>
  planFor(happened.toISOString().slice(0, 10), jstDateString(submitted), schedules[type] ?? DEFAULT_SCHEDULES.employee, kind);
