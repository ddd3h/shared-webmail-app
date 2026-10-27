// "What has to be transferred in this month": the list behind the monthly 全銀 file.
// Everything unpaid whose date is on or before the last day of the month is listed (earlier ones are marked 期日超過):
//   - pay statements (給与・賞与・業務委託費・役員報酬)  - on their pay date, or the 振込日 of the person's kind of worker when none was written
//   - payment requests (振込申請)                      - on their due date
//   - expense reimbursements (経費の立替金)             - on the day 締め日・振込日 plans (one line per person; claims inside a pay statement go with the statement)
import { prisma } from '@/lib/db';
import { payDate } from '@/lib/pay-schedule';
import { loadSchedules, planOf } from '@/lib/pay-schedule-server';
import { transferAmount } from '@/lib/payment';
import { WORKER_TYPE_LABEL, payslipTotals, type WorkerType } from '@/lib/work';
import { DEFAULT_SCHEDULES } from '@/lib/pay-schedule';
import type { ItemRef } from '@/lib/transfer-server';

export type MonthlyItem = {
  key: string; type: ItemRef['type']; ids: string[]; group: 'payroll' | 'payment' | 'expense'; kind_label: string;
  who: string; title: string; sub: string; amount: number; scheduled_date: string; overdue: boolean; batched: boolean; blocker: string | null;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const lastDayOf = (month: string) => ymd(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));

type Account = { verified_at: Date | null; account_last4: string; bank_name: string; branch_name: string } | null;
const accountBlocker = (a: Account) => (!a ? '受取口座が未登録' : !a.verified_at ? '受取口座が未確認' : null);
const accountSub = (a: Account) => (a ? `${a.bank_name} ${a.branch_name} ****${a.account_last4}` : '口座なし');

/** What a pay statement is called in the list: by whom it is for, and what it is. */
function slipKind(type: WorkerType, title: string): string {
  if (type === 'contractor') return '業務委託費';
  if (type === 'executive') return '役員報酬';
  return title; // 給与 / 賞与 / 立替金精算 ...
}

export async function loadMonthlyItems(month: string): Promise<MonthlyItem[]> {
  const end = lastDayOf(month);
  const start = `${month}-01`;
  const { schedules } = await loadSchedules();
  const [slips, pays, claims] = await Promise.all([
    prisma.payslips.findMany({
      where: { status: 'planned' }, orderBy: { created_at: 'asc' },
      include: { items: true, user: { select: { id: true, name: true, worker_type: true, bank_account: { select: { verified_at: true, account_last4: true, bank_name: true, branch_name: true } } } } },
    }),
    prisma.payment_requests.findMany({
      where: { status: 'approved', due_date: { lte: new Date(`${end}T00:00:00Z`) } }, orderBy: { due_date: 'asc' },
      include: { vendor: true, user: { select: { name: true } } },
    }),
    prisma.expense_claims.findMany({
      where: { status: 'approved', payment_method: 'personal', payslip_id: null }, orderBy: { created_at: 'asc' },
      include: { user: { select: { id: true, name: true, worker_type: true, bank_account: { select: { verified_at: true, account_last4: true, bank_name: true, branch_name: true } } } } },
    }),
  ]);

  const items: MonthlyItem[] = [];
  for (const p of slips) {
    const type = p.user.worker_type as WorkerType;
    const date = p.pay_date ? ymd(p.pay_date) : payDate(p.pay_month, schedules[type] ?? DEFAULT_SCHEDULES.employee);
    if (date > end) continue;
    const net = payslipTotals(p.items).net;
    items.push({
      key: `payslip:${p.id}`, type: 'payslip', ids: [p.id], group: 'payroll', kind_label: slipKind(type, p.title),
      who: p.user.name, title: `${p.pay_month} ${p.title}（${WORKER_TYPE_LABEL[type]}）`, sub: accountSub(p.user.bank_account), amount: net,
      scheduled_date: date, overdue: date < start, batched: !!p.batch_id, blocker: accountBlocker(p.user.bank_account) ?? (net <= 0 ? '支給額が0円以下' : null),
    });
  }
  for (const r of pays) {
    const date = ymd(r.due_date);
    items.push({
      key: `payment:${r.id}`, type: 'payment', ids: [r.id], group: 'payment', kind_label: '振込申請',
      who: r.vendor.name, title: r.title, sub: `申請者 ${r.user.name}`, amount: transferAmount(r),
      scheduled_date: date, overdue: date < start, batched: !!r.batch_id, blocker: r.vendor.verified_at ? null : '口座未確認',
    });
  }
  // expenses: one line per person; the day is the earliest planned pay day among their claims
  const byUser = new Map<string, typeof claims>();
  for (const c of claims) {
    const date = planOf(schedules, c.user.worker_type as WorkerType, c.expense_date, c.created_at, 'expense').pay_date;
    if (date > end) continue;
    byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c]);
  }
  for (const [userId, list] of byUser) {
    const u = list[0].user;
    const date = list.map(c => planOf(schedules, u.worker_type as WorkerType, c.expense_date, c.created_at, 'expense').pay_date).sort()[0];
    items.push({
      key: `expense:${userId}`, type: 'expense', ids: list.map(c => c.id), group: 'expense', kind_label: '経費',
      who: u.name, title: `経費の立替金（${list.length}件）`, sub: accountSub(u.bank_account), amount: list.reduce((s, c) => s + c.amount, 0),
      scheduled_date: date, overdue: date < start, batched: list.some(c => !!c.batch_id), blocker: accountBlocker(u.bank_account),
    });
  }
  return items.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.who.localeCompare(b.who));
}
