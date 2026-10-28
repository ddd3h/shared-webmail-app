// オートフローを実際に動かす側: データを集めて（plan.ts）、まだ送っていないものを記録してから DM で送る。
// 同じ宛先・同じ段階を二度送らないのは autoflow_notices の unique（送る前に1行作って「送った」ことにする）。
import { prisma } from '@/lib/db';
import { sendDirectMessage } from '@/lib/mattermost-dm';
import { getSetting, setSetting } from '@/lib/settings';
import { loadSchedules } from '@/lib/pay-schedule-server';
import { loadMonthlyItems } from '@/lib/transfer-monthly';
import { approversOf } from '@/lib/org-server';
import { addDays } from '@/lib/pay-schedule';
import { jstDateString } from '@/lib/work';
import { parseConfig, type AutoflowConfig } from './config';
import { planNotices, type ExpenseClaim, type ExpenseUser, type Notice, type PlanInput, type Recipient, type ReportWorker } from './plan';

const KEY = 'AUTOFLOW_CONFIG' as const;
const STALE_RUN_MS = 10 * 60_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10); // a @db.Date is stored as UTC midnight

export async function loadConfig(): Promise<AutoflowConfig> {
  return parseConfig(await getSetting(KEY).catch(() => null));
}
export async function saveConfig(config: AutoflowConfig, userId: string): Promise<void> {
  await setSetting(KEY, JSON.stringify(config), false, userId);
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const anyEnabled = (c: AutoflowConfig) => c.report.enabled || c.expense.enabled || c.payment.enabled;

/** 今日の通知を決めるのに要るデータを、有効な流れの分だけ読む。 */
export async function loadPlanInput(today: string, config: AutoflowConfig): Promise<PlanInput> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const { schedules } = await loadSchedules();
  const active = { locked_at: null };

  const financeP = config.payment.enabled || config.expense.enabled
    ? prisma.users.findMany({ where: { ...active, OR: [{ role: 'admin' }, { is_accounting: true }] }, select: { id: true, email: true } })
    : Promise.resolve([] as Recipient[]);

  // 業務報告書: 業務委託と準業務委託。直近の報告書の日付だけ（期間の判定には 2 か月あれば足りる）
  let reportWorkers: ReportWorker[] = [];
  if (config.report.enabled) {
    const users = await prisma.users.findMany({
      where: { ...active, worker_type: { in: ['contractor', 'quasi_contractor'] } },
      select: { id: true, email: true, name: true, worker_type: true, created_at: true },
    });
    const reports = users.length === 0 ? [] : await prisma.work_reports.findMany({
      where: { user_id: { in: users.map(u => u.id) }, report_date: { gte: new Date(`${addDays(today, -75)}T00:00:00Z`) } },
      select: { user_id: true, report_date: true },
    });
    const dates = new Map<string, string[]>();
    for (const r of reports) dates.set(r.user_id, [...(dates.get(r.user_id) ?? []), dayOf(r.report_date)]);
    reportWorkers = users.map(u => ({ id: u.id, email: u.email, name: u.name, worker_type: u.worker_type, joined: jstDateString(u.created_at), report_dates: dates.get(u.id) ?? [] }));
  }

  // 経費: 承認待ち・差戻し/却下のもの
  const expenseUsers = new Map<string, ExpenseUser>();
  const approvers = new Map<string, Recipient[]>();
  let claims: ExpenseClaim[] = [];
  const finance = await financeP;
  if (config.expense.enabled) {
    const rows = await prisma.expense_claims.findMany({
      where: { status: { in: ['pending', 'rejected'] }, expense_date: { gte: new Date(`${addDays(today, -150)}T00:00:00Z`) }, user: active },
      select: { user_id: true, title: true, amount: true, status: true, expense_date: true, created_at: true, user: { select: { id: true, email: true, name: true, worker_type: true } } },
    });
    claims = rows.map(r => ({ user_id: r.user_id, title: r.title, amount: r.amount, status: r.status as 'pending' | 'rejected', expense_date: dayOf(r.expense_date), submitted: jstDateString(r.created_at) }));
    for (const r of rows) expenseUsers.set(r.user_id, { id: r.user.id, email: r.user.email, name: r.user.name, worker_type: r.user.worker_type });
    // 承認できる人: 管理者（本人を除く）＋ 部署の長
    const admins = await prisma.users.findMany({ where: { ...active, role: 'admin' }, select: { id: true, email: true } });
    for (const userId of new Set(rows.filter(r => r.status === 'pending').map(r => r.user_id))) {
      const heads = await approversOf(userId);
      approvers.set(userId, [...new Map([...admins.filter(a => a.id !== userId), ...heads].map(a => [a.id, a])).values()]);
    }
  }

  // 振込日: まだ全銀ファイルにしていないもの
  let payItems: PlanInput['payItems'] = [];
  if (config.payment.enabled) {
    const month = addDays(today, config.payment.days_before).slice(0, 7);
    payItems = (await loadMonthlyItems(month)).filter(i => !i.batched).map(i => ({ scheduled_date: i.scheduled_date, amount: i.amount, group: i.group, blocker: i.blocker }));
  }

  return { today, config, schedules, appUrl, reportWorkers, expenseUsers, claims, approversOf: approvers, payItems, finance };
}

export type PreviewItem = Notice & { already_sent: boolean; user_name: string };
export type RunResult = { today: string; planned: number; sent: number; skipped: number; delivered: number; items: PreviewItem[] };

let running = false;

/**
 * 今日送る通知を作って送る。`dry` なら送らずに「送るはずのもの」だけ返す。
 * すでに送った（同じ宛先・同じ段階・同じ題材）ものは飛ばすので、何度呼んでも二重に届かない。
 */
export async function runAutoflow(opts: { now?: Date; dry?: boolean; config?: AutoflowConfig } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const today = jstDateString(now);
  const config = opts.config ?? await loadConfig();
  const empty: RunResult = { today, planned: 0, sent: 0, skipped: 0, delivered: 0, items: [] };
  if (!anyEnabled(config)) return empty;
  if (!opts.dry) { if (running) return empty; running = true; }
  try {
    const notices = planNotices(await loadPlanInput(today, config));
    const ids = [...new Set(notices.map(n => n.user.id))];
    const names = new Map((ids.length === 0 ? [] : await prisma.users.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
    const sentBefore = notices.length === 0 ? [] : await prisma.autoflow_notices.findMany({
      where: { OR: notices.map(n => ({ rule: n.rule, stage: n.stage, subject_key: n.subject_key, user_id: n.user.id })) }, select: { rule: true, stage: true, subject_key: true, user_id: true },
    });
    const keyOf = (n: { rule: string; stage: string; subject_key: string; user_id: string }) => `${n.rule}|${n.stage}|${n.subject_key}|${n.user_id}`;
    const done = new Set(sentBefore.map(keyOf));
    const items: PreviewItem[] = notices.map(n => ({ ...n, already_sent: done.has(keyOf({ ...n, user_id: n.user.id })), user_name: names.get(n.user.id) ?? '' }));
    const result: RunResult = { today, planned: items.length, sent: 0, skipped: items.filter(i => i.already_sent).length, delivered: 0, items };
    if (opts.dry) return result;

    // 1通ずつ順に送る（Mattermost に一斉に投げない）
    for (const n of items) {
      if (n.already_sent) continue;
      try {
        const row = await prisma.autoflow_notices.create({ data: { rule: n.rule, stage: n.stage, subject_key: n.subject_key, user_id: n.user.id, title: n.title } });
        const ok = await sendDirectMessage(n.user.id, n.user.email, n.text, n.type);
        result.sent++;
        if (ok) { result.delivered++; await prisma.autoflow_notices.update({ where: { id: row.id }, data: { delivered: true } }); }
      } catch (e) {
        if (isUnique(e)) { result.skipped++; continue; } // 別の実行が先に送った
        console.error('[autoflow] notice failed:', e);
      }
    }
    return result;
  } finally {
    if (!opts.dry) running = false;
  }
}

/**
 * 1日1回の定期実行。今日の分の枠（autoflow_runs）が取れたときだけ動く。
 * 途中で止まった枠（10分以上たっても終わっていない）は取り直す。重複は上の送信記録が止める。
 */
export async function runDaily(now = new Date()): Promise<RunResult | null> {
  const config = await loadConfig();
  if (!anyEnabled(config)) return null; // 何も ON でない日は枠を取らない（あとで ON にしたら、その日のうちに動く）
  const today = jstDateString(now);
  try {
    await prisma.autoflow_runs.create({ data: { run_date: today } });
  } catch (e) {
    if (!isUnique(e)) throw e;
    const prev = await prisma.autoflow_runs.findUnique({ where: { run_date: today } });
    if (!prev || prev.finished_at || now.getTime() - prev.started_at.getTime() < STALE_RUN_MS) return null;
    await prisma.autoflow_runs.update({ where: { run_date: today }, data: { started_at: now } });
  }
  const result = await runAutoflow({ now, config });
  await prisma.autoflow_runs.update({ where: { run_date: today }, data: { finished_at: new Date(), summary: JSON.stringify({ planned: result.planned, sent: result.sent, skipped: result.skipped, delivered: result.delivered }) } });
  return result;
}
