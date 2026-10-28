// オートフローの頭脳: 今日が何日で、誰が何を提出していないか、などから「今日送る通知」の一覧を作る。
// DB も送信も知らない純粋な関数（日付は日本時間の 'YYYY-MM-DD' の文字列で渡す）。送る・記録するのは run.ts。
import { mmText } from '@/lib/mattermost-dm';
import { addDays, addMonths, closingDate, expenseDeadline, periodOf, periodStart, planFor, reportDeadline, shortDate, type PaySchedule } from '@/lib/pay-schedule';
import { usesReports, type WorkerType } from '@/lib/work';
import type { AutoflowConfig } from './config';

export type Recipient = { id: string; email: string };
export type Notice = {
  rule: 'report' | 'expense' | 'payment';
  stage: 'eve' | 'closing' | 'final' | 'before' | 'on';
  subject_key: string;       // 同じ宛先・同じ段階・同じ題材は二度送らない（autoflow_notices の unique）
  user: Recipient;
  type: string;              // 通知の種類（アプリ内の通知一覧で「申請・給与」に入る前置きにする）
  title: string;             // 1行目（履歴に出す）
  text: string;              // DM の本文
};

export type Schedules = Record<WorkerType, PaySchedule>;

export type ReportWorker = Recipient & { name: string; worker_type: WorkerType; joined: string /* 登録した日 */; report_dates: string[] };
export type ExpenseClaim = { user_id: string; title: string; amount: number; status: 'pending' | 'rejected'; expense_date: string; submitted: string /* 申請した日 */ };
export type ExpenseUser = Recipient & { name: string; worker_type: WorkerType };
export type PayItem = { scheduled_date: string; amount: number; group: 'payroll' | 'payment' | 'expense'; blocker: string | null };

export type PlanInput = {
  today: string;
  config: AutoflowConfig;
  schedules: Schedules;
  appUrl: string;
  reportWorkers: ReportWorker[];
  expenseUsers: Map<string, ExpenseUser>;
  claims: ExpenseClaim[];
  approversOf: Map<string, Recipient[]>; // 申請者の id → 承認できる人
  payItems: PayItem[];                  // まだ全銀ファイルにしていないもの
  finance: Recipient[];                 // 経理と管理者
};

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const monthLabel = (period: string) => `${Number(period.slice(5, 7))}月分`;
const firstLine = (text: string) => text.split('\n')[0].replace(/\*\*/g, '').trim();
const notice = (n: Omit<Notice, 'title'>): Notice => ({ ...n, title: firstLine(n.text) });

// ── 業務報告書 ───────────────────────────────────────────────────────────────
// 前日（催促）・締め日（支払われない旨）・提出期限日（それでも未提出の再通知）。「出した」＝その期間の中の日付で1件でも報告書がある。
function reportNotices(i: PlanInput): Notice[] {
  const out: Notice[] = [];
  for (const w of i.reportWorkers) {
    if (!usesReports(w.worker_type)) continue;
    const s = i.schedules[w.worker_type];
    const here = periodOf(i.today, s);
    for (const period of [addMonths(here, -1), here, addMonths(here, 1)]) {
      const closing = closingDate(period, s);
      const deadline = reportDeadline(period, s);
      const stage = i.today === addDays(closing, -1) ? 'eve' : i.today === closing ? 'closing' : i.today === deadline && deadline > closing ? 'final' : null;
      if (!stage) continue;
      if (w.joined > closing) continue; // その期間が終わってから入った人には関係ない
      const start = periodStart(period, s);
      if (w.report_dates.some(d => d >= start && d <= closing)) continue;

      const label = monthLabel(period);
      const range = `${shortDate(start)}〜${shortDate(closing)}`;
      const dates = `締め日 ${shortDate(closing)}・提出期限 ${shortDate(deadline)}`;
      const text = stage === 'eve'
        ? `⏰ **業務報告書の締め日は明日です**\n\n${label}（${range}）の業務報告書が、まだ提出されていません。\n${dates}\n\n提出する: ${i.appUrl}/work`
        : stage === 'closing'
          ? `⚠️ **本日が締め日です。業務報告書が未提出です**\n\n${label}（${range}）の業務報告書が、まだ提出されていません。\n締め日までに提出がない場合、${label}の報酬は支払われません。提出期限（${shortDate(deadline)}）を過ぎると次の期間の分として扱われ、お支払いも遅れます。\n\n今すぐ提出する: ${i.appUrl}/work`
          : `🚨 **業務報告書の提出期限です（再通知）**\n\n${label}（${range}）の業務報告書が、締め日を過ぎてもまだ提出されていません。\n本日が提出期限です。提出がない場合、${label}の報酬は支払われません。\n\n今すぐ提出する: ${i.appUrl}/work`;
      out.push(notice({ rule: 'report', stage, subject_key: `report:${period}`, user: { id: w.id, email: w.email }, type: 'work_report_reminder', text }));
    }
  }
  return out;
}

// ── 経費 ─────────────────────────────────────────────────────────────────────
// 申請期限の N 日前と当日に、承認待ち・差戻し/却下の経費がある人へ。承認待ちは承認する人へもまとめて。
function expenseNotices(i: PlanInput): Notice[] {
  const out: Notice[] = [];
  type Group = { period: string; deadline: string; userId: string; pending: ExpenseClaim[]; rejected: ExpenseClaim[] };
  const groups = new Map<string, Group>();
  for (const c of i.claims) {
    const u = i.expenseUsers.get(c.user_id);
    if (!u) continue;
    const s = i.schedules[u.worker_type];
    const plan = planFor(c.expense_date, c.submitted, s, 'expense');
    const deadline = expenseDeadline(plan.period, s);
    const key = `${c.user_id}|${plan.period}`;
    const g = groups.get(key) ?? { period: plan.period, deadline, userId: c.user_id, pending: [], rejected: [] };
    (c.status === 'pending' ? g.pending : g.rejected).push(c);
    groups.set(key, g);
  }

  const list = (cs: ExpenseClaim[]) => cs.slice(0, 5).map(c => `・${mmText(c.title, 40)} ${yen(c.amount)}`).join('\n') + (cs.length > 5 ? `\n…ほか${cs.length - 5}件` : '');
  const approverRows = new Map<string, { to: Recipient; period: string; deadline: string; stage: 'before' | 'on'; who: Map<string, number> }>();

  for (const g of groups.values()) {
    const stage = i.today === g.deadline ? 'on' : i.today === addDays(g.deadline, -i.config.expense.days_before) ? 'before' : null;
    if (!stage) continue;
    const u = i.expenseUsers.get(g.userId)!;
    const label = monthLabel(g.period);
    const when = stage === 'on' ? '本日が' : `あと${i.config.expense.days_before}日で`;
    const parts: string[] = [];
    if (g.rejected.length > 0) parts.push(`差戻し・却下（直して再申請が必要）: ${g.rejected.length}件\n${list(g.rejected)}`);
    if (g.pending.length > 0) parts.push(`承認待ち: ${g.pending.length}件\n${list(g.pending)}`);
    const text = `💴 **経費の申請期限${stage === 'on' ? 'です' : 'が近づいています'}**\n\n${label}の経費の申請期限は ${shortDate(g.deadline)} です（${when}期限）。\n期限を過ぎると、次の期間の分として扱われ、返金も遅れます。\n\n${parts.join('\n\n')}\n\n確認する: ${i.appUrl}/expenses`;
    out.push(notice({ rule: 'expense', stage, subject_key: `expense:${g.period}`, user: { id: u.id, email: u.email }, type: 'expense_reminder', text }));

    if (g.pending.length > 0) {
      for (const a of i.approversOf.get(g.userId) ?? []) {
        const k = `${a.id}|${g.period}|${stage}`;
        const row = approverRows.get(k) ?? { to: a, period: g.period, deadline: g.deadline, stage, who: new Map<string, number>() };
        row.who.set(u.name, (row.who.get(u.name) ?? 0) + g.pending.length);
        approverRows.set(k, row);
      }
    }
  }

  for (const r of approverRows.values()) {
    const total = [...r.who.values()].reduce((a, b) => a + b, 0);
    const who = [...r.who].slice(0, 8).map(([name, n]) => `・${mmText(name, 30)}（${n}件）`).join('\n') + (r.who.size > 8 ? `\n…ほか${r.who.size - 8}人` : '');
    const text = `✅ **承認待ちの経費があります（申請期限 ${shortDate(r.deadline)}）**\n\n${monthLabel(r.period)}の経費が、あわせて${total}件、承認を待っています。\n\n${who}\n\n承認する: ${i.appUrl}/approvals`;
    out.push(notice({ rule: 'expense', stage: r.stage, subject_key: `expense-approve:${r.period}`, user: r.to, type: 'expense_reminder', text }));
  }
  return out;
}

// ── 振込日 ───────────────────────────────────────────────────────────────────
// 振込日の N 日前と当日に、経理と管理者へ。件数と合計だけ（口座の情報は載せない）。
function paymentNotices(i: PlanInput): Notice[] {
  const out: Notice[] = [];
  const byDate = new Map<string, PayItem[]>();
  for (const p of i.payItems) byDate.set(p.scheduled_date, [...(byDate.get(p.scheduled_date) ?? []), p]);
  const GROUP = { payroll: '給与・報酬', expense: '経費', payment: '振込申請' } as const;

  for (const [date, items] of byDate) {
    const stage = i.today === date ? 'on' : i.today === addDays(date, -i.config.payment.days_before) ? 'before' : null;
    if (!stage) continue;
    const total = items.reduce((s, p) => s + p.amount, 0);
    const parts = (Object.keys(GROUP) as (keyof typeof GROUP)[]).flatMap(g => { const n = items.filter(p => p.group === g).length; return n > 0 ? [`${GROUP[g]} ${n}件`] : []; });
    const blocked = items.filter(p => p.blocker).length;
    const head = stage === 'on' ? `本日（${shortDate(date)}）は振込日です` : `${shortDate(date)}の振込日まで、あと${i.config.payment.days_before}日です`;
    const text = `🏦 **${head}**\n\n振込予定: ${items.length}件・合計 ${yen(total)}（${parts.join('、')}）\n` +
      (blocked > 0 ? `⚠️ 口座が未登録・未確認などで、まだ振り込めないもの: ${blocked}件\n` : '') +
      `\n誰にいくら払うかの一覧を確認し、承認して全銀ファイルを作ってください。\n${i.appUrl}/transfers`;
    for (const f of i.finance) {
      out.push(notice({ rule: 'payment', stage, subject_key: `payday:${date}`, user: f, type: 'payment_reminder', text }));
    }
  }
  return out;
}

export function planNotices(i: PlanInput): Notice[] {
  return [
    ...(i.config.report.enabled ? reportNotices(i) : []),
    ...(i.config.expense.enabled ? expenseNotices(i) : []),
    ...(i.config.payment.enabled ? paymentNotices(i) : []),
  ];
}
