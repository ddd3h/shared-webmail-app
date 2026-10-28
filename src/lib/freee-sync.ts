// Sends money that has moved out to freee, once each: a paid pay statement, a paid payment request, a paid expense reimbursement.
// What is sent is what was actually paid (the net of a statement, the amount transferred for a payment request), on the day it was paid,
// as an expense deal paid from the company's bank account. The accounts (勘定科目) come from the administrator's mapping.
import { prisma } from '@/lib/db';
import { transferAmount } from '@/lib/payment';
import { isContractorLike, jstDateString, payslipTotals, type WorkerType } from '@/lib/work';
import { createDeal, freeeReady, loadFreeeConfig, type AccountMap, type FreeeConfig } from '@/lib/freee';

export type Movement = {
  source_type: 'payslip' | 'payment' | 'expense'; source_id: string; date: string; amount: number; description: string;
  /** Where the money goes, by account key (see MAP_KINDS), with the amounts. They add up to `amount`. */
  parts: { key: string; amount: number; description: string }[];
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 250);

/** The movements paid on or after `from` (the day the connection was made / chosen): everything before it belongs to the books already. */
export async function collectMovements(from: string): Promise<Movement[]> {
  const start = new Date(`${from}T00:00:00Z`);
  const [slips, pays, claims] = await Promise.all([
    prisma.payslips.findMany({
      where: { status: 'paid', OR: [{ pay_date: { gte: start } }, { pay_date: null, updated_at: { gte: start } }] },
      include: { items: true, user: { select: { name: true, worker_type: true } }, expense_claims: { select: { category: true, amount: true } } },
    }),
    prisma.payment_requests.findMany({ where: { status: 'paid', paid_at: { gte: start } }, include: { vendor: { select: { name: true } } } }),
    // a claim inside a pay statement is part of the statement's deal
    prisma.expense_claims.findMany({ where: { status: 'paid', payslip_id: null, reimbursed_at: { gte: start } }, include: { user: { select: { name: true } } } }),
  ]);
  const out: Movement[] = [];
  for (const p of slips) {
    const net = payslipTotals(p.items).net;
    const type = p.user.worker_type as WorkerType;
    const mainKey = isContractorLike(type) ? 'contractor' : type === 'executive' ? 'executive' : 'salary';
    const date = p.pay_date ? ymd(p.pay_date) : jstDateString(p.updated_at);
    const label = `${p.title} ${p.pay_month} ${p.user.name}`;
    // the part of the statement that is expense reimbursement is booked as expenses, the rest as pay
    const byCat = new Map<string, number>();
    for (const c of p.expense_claims) byCat.set(c.category, (byCat.get(c.category) ?? 0) + c.amount);
    const expenseTotal = [...byCat.values()].reduce((s, n) => s + n, 0);
    const parts = net - expenseTotal > 0 && expenseTotal > 0
      ? [{ key: mainKey, amount: net - expenseTotal, description: label }, ...[...byCat].map(([cat, amount]) => ({ key: `expense:${cat}`, amount, description: `${label} 立替金（${cat}）` }))]
      : [{ key: mainKey, amount: net, description: label }];
    out.push({ source_type: 'payslip', source_id: p.id, date, amount: net, description: clip(label), parts });
  }
  for (const r of pays) {
    const amount = transferAmount(r);
    const label = `${r.vendor.name} ${r.title}`;
    out.push({ source_type: 'payment', source_id: r.id, date: ymd(r.paid_at!), amount, description: clip(label), parts: [{ key: 'payment', amount, description: clip(label) }] });
  }
  for (const c of claims) {
    const label = `経費精算 ${c.user.name} ${c.title}`;
    out.push({ source_type: 'expense', source_id: c.id, date: ymd(c.reimbursed_at!), amount: c.amount, description: clip(label), parts: [{ key: `expense:${c.category}`, amount: c.amount, description: clip(label) }] });
  }
  return out;
}

/** Which account an amount goes to: the category's own, or (for expenses) the general expense account. */
export function accountFor(map: AccountMap, key: string) {
  return map[key] ?? (key.startsWith('expense:') ? map.expense : undefined);
}

const KIND_NAME: Record<string, string> = { salary: '給与', executive: '役員報酬', contractor: '業務委託費', payment: '振込申請', expense: '経費' };
const keyName = (key: string) => (key.startsWith('expense:') ? `経費（${key.slice(8)}）` : KIND_NAME[key] ?? key);

/** A movement as a freee deal, or the reason it cannot be made yet (an account that has not been chosen). */
export function dealDetails(m: Movement, map: AccountMap): { ok: true; details: { account_item_id: number; tax_code: number; amount: number; description: string }[] } | { ok: false; error: string } {
  const details = [];
  for (const p of m.parts) {
    if (p.amount <= 0) continue;
    const a = accountFor(map, p.key);
    if (!a) return { ok: false, error: `勘定科目が未設定です: ${keyName(p.key)}` };
    details.push({ account_item_id: a.account_item_id, tax_code: a.tax_code, amount: p.amount, description: p.description });
  }
  return { ok: true, details };
}

export type SyncResult = { ok: true; sent: number; failed: number; skipped: number; pending: number } | { ok: false; error: 'not_ready' };

const MAX_PER_RUN = 100;
const STALE_MS = 10 * 60_000;
/** A send that never finished (the server stopped) may or may not have reached freee: it is not retried by itself, a person checks. */
export const STALE_ERROR = '前回の送信が途中で止まりました。freeeに同じ取引がないか確認してから、再送するか「送らない」にしてください';
let running = false;

/** Sends what has not been sent (and retries what failed). Safe to call often: one run at a time, and a thing is claimed before it is sent. */
export async function syncToFreee(cfg?: FreeeConfig): Promise<SyncResult> {
  const c = cfg ?? await loadFreeeConfig();
  if (!freeeReady(c)) return { ok: false, error: 'not_ready' };
  if (running) return { ok: true, sent: 0, failed: 0, skipped: 0, pending: 0 };
  running = true;
  try {
    await prisma.freee_exports.updateMany({ where: { status: 'sending', updated_at: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'failed', error: STALE_ERROR } });
    const movements = await collectMovements(c.syncFrom!);
    const existing = new Map((await prisma.freee_exports.findMany({ select: { source_type: true, source_id: true, status: true, error: true } })).map(e => [`${e.source_type}:${e.source_id}`, e.status === 'failed' && e.error === STALE_ERROR ? 'stale' : e.status]));
    const todo = movements.filter(m => { const s = existing.get(`${m.source_type}:${m.source_id}`); return !s || s === 'failed' || s === 'pending'; }).sort((a, b) => a.date.localeCompare(b.date));
    const r = { sent: 0, failed: 0, skipped: 0, pending: Math.max(0, todo.length - MAX_PER_RUN) };
    for (const m of todo.slice(0, MAX_PER_RUN)) {
      const where = { source_type_source_id: { source_type: m.source_type, source_id: m.source_id } };
      // claim it: the unique row means two runs cannot both send the same thing
      const claimed = existing.has(`${m.source_type}:${m.source_id}`)
        ? (await prisma.freee_exports.updateMany({ where: { source_type: m.source_type, source_id: m.source_id, status: { in: ['failed', 'pending'] } }, data: { status: 'sending', amount: m.amount, paid_date: new Date(`${m.date}T00:00:00Z`), description: m.description, attempts: { increment: 1 } } })).count === 1
        : await prisma.freee_exports.create({ data: { source_type: m.source_type, source_id: m.source_id, status: 'sending', amount: m.amount, paid_date: new Date(`${m.date}T00:00:00Z`), description: m.description, attempts: 1 } }).then(() => true, () => false);
      if (!claimed) continue;
      if (m.amount <= 0) { await prisma.freee_exports.update({ where, data: { status: 'skipped', error: '金額が0円以下のため送りません' } }); r.skipped++; continue; }
      const d = dealDetails(m, c.map);
      if (!d.ok) { await prisma.freee_exports.update({ where, data: { status: 'failed', error: d.error } }); r.failed++; continue; }
      const res = await createDeal({ companyId: c.companyId!, date: m.date, walletable: c.walletable!, details: d.details });
      if (res.ok) { await prisma.freee_exports.update({ where, data: { status: 'sent', freee_deal_id: res.data.deal.id, sent_at: new Date(), error: null } }); r.sent++; }
      else { await prisma.freee_exports.update({ where, data: { status: 'failed', error: res.message } }); r.failed++; if (res.status === 401) break; }
    }
    return { ok: true, ...r };
  } finally { running = false; }
}

/** After money is paid: send it soon, without making the person wait or fail if freee is down. Does nothing unless automatic sending is on. */
export function triggerFreeeSync() {
  void (async () => {
    const c = await loadFreeeConfig();
    if (c.autoSync && freeeReady(c)) await syncToFreee(c);
  })().catch(e => console.error('[freee] auto sync failed:', e?.message || e));
}
