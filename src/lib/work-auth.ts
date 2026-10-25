import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { DEFAULT_AUTO_BREAK_MINUTES, DEFAULT_DAILY_MINUTES, type WorkerType } from '@/lib/work';

export type Actor = { id: string; name: string; role: string; worker_type: WorkerType; is_accounting?: boolean };

export async function getActor(userId: string): Promise<Actor | null> {
  const u = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, worker_type: true, is_accounting: true },
  });
  return u as Actor | null;
}

export const isAdmin = (a: Actor) => a.role === 'admin';
// 経理担当: admins plus people flagged as accounting staff. They handle bank transfers (全銀 files, marking paid)
// but approving requests stays with admins.
export const isFinance = (a: Actor) => a.role === 'admin' || !!a.is_accounting;

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
