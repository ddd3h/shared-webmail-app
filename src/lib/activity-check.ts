// 準業務委託の業務報告書: 「その日、本当に仕事をしていたか」の手がかりとして、ログインの記録を見る。
// 報告する日（report_date）を含む直近 N 日（既定14日）に、1回もログインしていなければ「活動なし」。
import { prisma } from '@/lib/db';
import { loadConfig } from '@/lib/autoflow/config-server';
import { addDays } from '@/lib/pay-schedule';
import { jstDateString, type WorkerType } from '@/lib/work';

export type ActivityVerdict = { suspicious: boolean; days: number; last_login: string | null /* 報告する日までで、最後にログインした日 */; window_start: string };

/** 純粋な判定。lastLoginDay は「報告する日（を含む）までで、最後にログインした日」。 */
export function judgeActivity(reportDate: string, lastLoginDay: string | null, days: number): ActivityVerdict {
  const window_start = addDays(reportDate, -(days - 1));
  return { suspicious: lastLoginDay === null || lastLoginDay < window_start, days, last_login: lastLoginDay, window_start };
}

/** 本人が確認して提出した、という印に残す一文（経理が読む）。 */
export function activityNote(v: ActivityVerdict): string {
  return v.last_login
    ? `報告日までの${v.days}日間にログインの記録がありません（最後のログイン ${v.last_login}）。警告を確認のうえ、本人が提出しました`
    : `ログインの記録がありません。警告を確認のうえ、本人が提出しました`;
}

/**
 * この人の、この日の報告書は怪しいか。準業務委託で、設定が ON のときだけ調べる（それ以外は null = 確認しない）。
 * 報告書を出すその瞬間のログインは数えない（その日より後のログインは、その日に働いた証拠にならない）。
 */
export async function checkReportActivity(actor: { id: string; worker_type: WorkerType }, reportDate: string): Promise<ActivityVerdict | null> {
  if (actor.worker_type !== 'quasi_contractor') return null;
  const { activity } = await loadConfig();
  if (!activity.enabled) return null;
  const end = new Date(`${addDays(reportDate, 1)}T00:00:00+09:00`); // 報告する日の終わりまで
  const last = await prisma.login_logs.findFirst({
    where: { user_id: actor.id, success: true, created_at: { lt: end } },
    orderBy: { created_at: 'desc' }, select: { created_at: true },
  });
  return judgeActivity(reportDate, last ? jstDateString(last.created_at) : null, activity.days);
}
