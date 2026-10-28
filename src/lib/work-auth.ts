import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { DEFAULT_AUTO_BREAK_MINUTES, DEFAULT_DAILY_MINUTES, type WithholdingClass, type WorkerType } from '@/lib/work';

export type Actor = { id: string; name: string; role: string; worker_type: WorkerType; is_accounting?: boolean; is_hr?: boolean; withholding_class?: WithholdingClass };

export async function getActor(userId: string): Promise<Actor | null> {
  const u = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, worker_type: true, is_accounting: true, is_hr: true, withholding_class: true },
  });
  return u as Actor | null;
}

export const isAdmin = (a: Actor) => a.role === 'admin';
// 経理担当: admins plus people flagged as accounting staff. They see and handle everything about money and pay, whatever
// the organisation: expenses and reimbursement, trips and allowances, attendance, payslips, vendors and bank transfers.
// Only approving / rejecting requests stays with admins and the heads of units (docs/23).
export const isFinance = (a: Actor) => a.role === 'admin' || !!a.is_accounting;
// 年末調整 is handled by 経理 and 人事 together (and admins): they see everybody's declarations and confirm them.
export const isYearEndStaff = (a: Actor) => a.role === 'admin' || !!a.is_accounting || !!a.is_hr;

function intSetting(v: string | null, fallback: number, max: number) {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

export async function getWorkSettings() {
  const [daily, brk] = await Promise.all([getSetting('WORK_DAILY_MINUTES'), getSetting('WORK_AUTO_BREAK_MINUTES')]);
  return {
    daily_minutes: intSetting(daily, DEFAULT_DAILY_MINUTES, 1440),
    auto_break_minutes: intSetting(brk, DEFAULT_AUTO_BREAK_MINUTES, 240),
  };
}
