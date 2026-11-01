// DB side of 業務報告書 for 準業務委託: the one-per-period rule, and putting together the several reports a person had already handed in.
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { loadSchedules } from '@/lib/pay-schedule-server';
import { toDbDate, type WorkerType } from '@/lib/work';
import { mergeReports, periodSpan, type ReportRow } from '@/lib/work-reports';
import { DEFAULT_SCHEDULES } from '@/lib/pay-schedule';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The report a person already has in the period of `reportDate` (other than `exceptId`), or null. */
export async function reportInPeriod(userId: string, workerType: WorkerType, reportDate: string, exceptId?: string): Promise<{ id: string; report_date: string } | null> {
  const { schedules } = await loadSchedules();
  const { start, end } = periodSpan(reportDate, schedules[workerType] ?? DEFAULT_SCHEDULES.employee);
  const found = await prisma.work_reports.findFirst({
    where: { user_id: userId, report_date: { gte: toDbDate(start), lte: toDbDate(end) }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { created_at: 'asc' }, select: { id: true, report_date: true },
  });
  return found ? { id: found.id, report_date: ymd(found.report_date) } : null;
}

export type MergePlanItem = { user_id: string; user_name: string; period: string; count: number; keep_id: string };

/** Everybody who has more than one report in a period (準業務委託 only). With `apply`, each group becomes one report. */
export async function mergeQuasiReports(apply: boolean, actorId?: string): Promise<MergePlanItem[]> {
  const { schedules } = await loadSchedules();
  const rows = await prisma.work_reports.findMany({
    where: { user: { worker_type: 'quasi_contractor' } },
    include: { user: { select: { name: true } } }, orderBy: [{ user_id: 'asc' }, { report_date: 'asc' }, { created_at: 'asc' }],
  });
  const groups = new Map<string, { name: string; period: string; rows: ReportRow[] }>();
  for (const r of rows) {
    const { period } = periodSpan(ymd(r.report_date), schedules.quasi_contractor ?? DEFAULT_SCHEDULES.quasi_contractor);
    const key = `${r.user_id}|${period}`;
    const g = groups.get(key) ?? { name: r.user.name, period, rows: [] };
    g.rows.push({ id: r.id, user_id: r.user_id, report_date: ymd(r.report_date), title: r.title, content: r.content, hours: r.hours === null ? null : Number(r.hours), activity_flag: r.activity_flag, activity_note: r.activity_note, created_at: r.created_at });
    groups.set(key, g);
  }
  const plan: MergePlanItem[] = [];
  for (const g of groups.values()) {
    if (g.rows.length < 2) continue;
    const m = mergeReports(g.period, g.rows);
    plan.push({ user_id: g.rows[0].user_id, user_name: g.name, period: g.period, count: g.rows.length, keep_id: m.keep_id });
    if (!apply) continue;
    await prisma.$transaction([
      prisma.work_reports.update({ where: { id: m.keep_id }, data: { report_date: toDbDate(m.report_date), title: m.title, content: m.content, hours: m.hours, activity_flag: m.activity_flag, activity_note: m.activity_note } }),
      prisma.work_reports.deleteMany({ where: { id: { in: m.remove_ids } } }),
    ]);
    await logAudit({ actorUserId: actorId, actionType: 'work_reports_merged', targetType: 'users', targetId: g.rows[0].user_id, metadata: { period: g.period, kept: m.keep_id, removed: m.remove_ids } });
  }
  return plan;
}
