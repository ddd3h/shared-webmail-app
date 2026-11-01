// Builds 全銀 transfer files from approved payment requests or pay statements and records them as batches.
//
// Flow of createBatch: check the company settings → turn every id into a line (or a problem) → refuse if any
// problem → build the file → save it and claim the items in ONE transaction.
import { accountChangedSinceApproval, ACCOUNT_CHANGED_REASON } from '@/lib/payment-fp';
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { transferAmount } from '@/lib/payment';
import { payslipTotals, jstDateString } from '@/lib/work';
import { CATEGORY_LABEL, buildZengin, validateHeader, validateRow, type CategoryCode, type ZenginRow } from '@/lib/zengin';
import { loadZenginSettings, toHeader } from '@/lib/zengin-settings';

export type Problem = { id: string; label: string; reason: string };
// `ref` (monthly files): what the line stands for, so the right rows are claimed. One expense line covers all of one person's claims.
export type ItemRef = { type: 'payslip' | 'payment' | 'expense'; ids: string[] };
type Line = ZenginRow & { id: string; label: string; ref?: ItemRef };
type Kind = 'payment' | 'payroll' | 'monthly';
type Loaded = { lines: Line[]; problems: Problem[] };

export type CreateInput = { kind: Kind; ids: string[]; items?: ItemRef[]; category: CategoryCode; transferDate: string; force: boolean; actorId: string };
export type CreateResult =
  | { ok: true; id: string; count: number; total: number; fileName: string }
  | { ok: false; status: number; error: string; message?: string; problems?: Problem[] };

const ALREADY_BATCHED = '作成済みの全銀データに含まれています（二重振込の防止）。作り直す場合は「作成済みも含める」を選んでください';
const DAY_MS = 86400_000;
const MAX_DAYS_AHEAD = 60;

/** A bank can't execute a transfer dated in the past, and a date months away is almost surely a typo. */
export function isValidTransferDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) return false;
  return s >= jstDateString(new Date()) && s <= jstDateString(new Date(Date.now() + MAX_DAYS_AHEAD * DAY_MS));
}

const readAccountNumber = (enc: string) => decrypt(enc).catch(() => '');
const batchedReason = (batchId: string | null, force: boolean) => (batchId && !force ? ALREADY_BATCHED : null);

/** Runs the file-format check on a ready line; returns the line, or the problem that keeps it out. */
function checkLine(line: Line, problem: string | null): { line: Line } | { problem: Problem } {
  const reason = problem ?? validateRow(line);
  return reason ? { problem: { id: line.id, label: line.label, reason } } : { line };
}

/** Collects the outcome for each id so one pass reports every problem, not just the first. */
async function collect(ids: string[], inspect: (id: string) => Promise<{ line: Line } | { problem: Problem }>): Promise<Loaded> {
  const out: Loaded = { lines: [], problems: [] };
  for (const id of ids) {
    const r = await inspect(id);
    if ('line' in r) out.lines.push(r.line); else out.problems.push(r.problem);
  }
  return out;
}

async function loadPaymentLines(ids: string[], force: boolean): Promise<Loaded> {
  const found = new Map((await prisma.payment_requests.findMany({ where: { id: { in: ids } }, include: { vendor: true } })).map(r => [r.id, r]));
  return collect(ids, async id => {
    const r = found.get(id);
    if (!r) return { problem: { id, label: id, reason: '申請が見つかりません' } };
    const v = r.vendor;
    const problem =
      r.status !== 'approved' ? '承認済み（振込待ち）ではありません' :
      !v.verified_at ? '振込先の口座が未確認です' :
      accountChangedSinceApproval(r, v) ? ACCOUNT_CHANGED_REASON :
      batchedReason(r.batch_id, force);
    return checkLine({
      id, label: `${v.name} 宛「${r.title}」`, bankCode: v.bank_code ?? '', bankName: v.bank_name, branchCode: v.branch_code ?? '', branchName: v.branch_name,
      accountType: v.account_type as ZenginRow['accountType'], accountNumber: await readAccountNumber(v.account_number_enc),
      holder: v.account_holder, amount: transferAmount(r),
    }, problem);
  });
}

async function loadPayrollLines(ids: string[], force: boolean): Promise<Loaded> {
  const found = new Map((await prisma.payslips.findMany({ where: { id: { in: ids } }, include: { items: true, user: { include: { bank_account: true } } } })).map(p => [p.id, p]));
  return collect(ids, async id => {
    const p = found.get(id);
    if (!p) return { problem: { id, label: id, reason: '明細が見つかりません' } };
    const a = p.user.bank_account;
    const problem =
      p.status !== 'planned' ? '支払予定の明細ではありません（支払済み）' :
      !a ? '受取口座が登録されていません' :
      !a.verified_at ? '受取口座が未確認です' :
      batchedReason(p.batch_id, force);
    return checkLine({
      id, label: `${p.user.name} ${p.pay_month} ${p.title}`, bankCode: a?.bank_code ?? '', bankName: a?.bank_name ?? '', branchCode: a?.branch_code ?? '', branchName: a?.branch_name ?? '',
      accountType: (a?.account_type ?? 'ordinary') as ZenginRow['accountType'], accountNumber: a ? await readAccountNumber(a.account_number_enc) : '',
      holder: a?.account_holder ?? '', amount: payslipTotals(p.items).net,
    }, problem);
  });
}

/** One line per person for approved out-of-pocket claims that are not in a pay statement: they are paid back to the person's own account. */
async function loadExpenseLines(claimIds: string[], force: boolean): Promise<Loaded> {
  const rows = await prisma.expense_claims.findMany({ where: { id: { in: claimIds } }, include: { user: { include: { bank_account: true } } } });
  const found = new Map(rows.map(c => [c.id, c]));
  const out: Loaded = { lines: [], problems: [] };
  const byUser = new Map<string, typeof rows>();
  for (const id of claimIds) {
    const c = found.get(id);
    if (!c) { out.problems.push({ id, label: id, reason: '経費の申請が見つかりません' }); continue; }
    byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c]);
  }
  for (const [userId, claims] of byUser) {
    const u = claims[0].user;
    const a = u.bank_account;
    const key = `expense:${userId}`;
    const bad = claims.find(c => c.status !== 'approved' || c.payment_method !== 'personal') ? '承認済みの立替ではない経費が含まれています'
      : claims.find(c => c.payslip_id) ? '給与明細に合算済みの経費が含まれています（明細と一緒に振り込まれます）'
      : null;
    const problem = bad ?? (!a ? '受取口座が登録されていません' : !a.verified_at ? '受取口座が未確認です' : claims.some(c => batchedReason(c.batch_id, force)) ? ALREADY_BATCHED : null);
    const r = checkLine({
      id: key, label: `${u.name} 経費の立替金（${claims.length}件）`, ref: { type: 'expense', ids: claims.map(c => c.id) },
      bankCode: a?.bank_code ?? '', bankName: a?.bank_name ?? '', branchCode: a?.branch_code ?? '', branchName: a?.branch_name ?? '',
      accountType: (a?.account_type ?? 'ordinary') as ZenginRow['accountType'], accountNumber: a ? await readAccountNumber(a.account_number_enc) : '',
      holder: a?.account_holder ?? '', amount: claims.reduce((s, c) => s + c.amount, 0),
    }, problem);
    if ('line' in r) out.lines.push(r.line); else out.problems.push(r.problem);
  }
  return out;
}

/** Everything that has to be transferred in a month, in one file: pay statements (給与・賞与・業務委託費・役員報酬), payment requests and expenses. */
async function loadMonthlyLines(items: ItemRef[], force: boolean): Promise<Loaded> {
  const ids = (type: ItemRef['type']) => [...new Set(items.filter(i => i.type === type).flatMap(i => i.ids))];
  const [slips, pays, claims] = await Promise.all([
    ids('payslip').length ? loadPayrollLines(ids('payslip'), force) : { lines: [], problems: [] },
    ids('payment').length ? loadPaymentLines(ids('payment'), force) : { lines: [], problems: [] },
    ids('expense').length ? loadExpenseLines(ids('expense'), force) : { lines: [], problems: [] },
  ]);
  const tag = (l: Line, type: ItemRef['type']): Line => ({ ...l, id: `${type}:${l.id}`, ref: { type, ids: [l.id] } });
  const tagP = (p: Problem, type: ItemRef['type']): Problem => ({ ...p, id: `${type}:${p.id}` });
  return {
    lines: [...slips.lines.map(l => tag(l, 'payslip')), ...pays.lines.map(l => tag(l, 'payment')), ...claims.lines],
    problems: [...slips.problems.map(p => tagP(p, 'payslip')), ...pays.problems.map(p => tagP(p, 'payment')), ...claims.problems],
  };
}

const fileNameFor = (kind: Kind, transferDate: string) =>
  `zengin-${kind}-${transferDate.replace(/-/g, '')}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.txt`;

/**
 * Saves the file and marks the items as belonging to it, atomically.
 * The update only touches items that are still free (or any, with `force`), so two people pressing 作成 at the same
 * moment cannot both claim the same item: the loser's count is short and the whole thing rolls back.
 */
class ItemsChanged extends Error {}
async function saveBatch(input: CreateInput, lines: Line[], file: ReturnType<typeof buildZengin>): Promise<{ id: string; fileName: string }> {
  const fileName = fileNameFor(input.kind, input.transferDate);
  const ids = lines.map(l => l.id);
  return prisma.$transaction(async tx => {
    const batch = await tx.transfer_batches.create({
      data: {
        kind: input.kind, category_code: input.category, transfer_date: new Date(`${input.transferDate}T00:00:00Z`), item_count: file.count,
        total_amount: file.total, file_name: fileName, content_b64: Buffer.from(file.bytes).toString('base64'), created_by_id: input.actorId,
      },
    });
    const free = input.force ? {} : { batch_id: null };
    if (input.kind === 'monthly') {
      // each kind of item is claimed on its own; a short count in any of them rolls the whole file back
      const refs = (type: ItemRef['type']) => lines.flatMap(l => (l.ref?.type === type ? l.ref.ids : []));
      const [payslips, payments, expenses] = [refs('payslip'), refs('payment'), refs('expense')];
      const done = await Promise.all([
        payslips.length ? tx.payslips.updateMany({ where: { id: { in: payslips }, status: 'planned', ...free }, data: { batch_id: batch.id } }) : { count: 0 },
        payments.length ? tx.payment_requests.updateMany({ where: { id: { in: payments }, status: 'approved', ...free }, data: { batch_id: batch.id } }) : { count: 0 },
        expenses.length ? tx.expense_claims.updateMany({ where: { id: { in: expenses }, status: 'approved', payment_method: 'personal', payslip_id: null, ...free }, data: { batch_id: batch.id } }) : { count: 0 },
      ]);
      if (done[0].count !== payslips.length || done[1].count !== payments.length || done[2].count !== expenses.length) throw new ItemsChanged();
      return { id: batch.id, fileName };
    }
    const claimed = input.kind === 'payment'
      ? await tx.payment_requests.updateMany({ where: { id: { in: ids }, status: 'approved', ...free }, data: { batch_id: batch.id } })
      : await tx.payslips.updateMany({ where: { id: { in: ids }, status: 'planned', ...free }, data: { batch_id: batch.id } });
    if (claimed.count !== ids.length) throw new ItemsChanged();
    return { id: batch.id, fileName };
  });
}

/** All or nothing: one unusable line means no file, so a half-filled file can never be uploaded to the bank by mistake. */
export async function createBatch(input: CreateInput): Promise<CreateResult> {
  const header = toHeader(await loadZenginSettings(), input.category, input.transferDate);
  const headerProblem = validateHeader(header);
  if (headerProblem) return { ok: false, status: 422, error: 'zengin_settings', message: `全銀の設定（委託者情報）を確認してください: ${headerProblem}` };

  const ids = [...new Set(input.ids)];
  const { lines, problems } = await (input.kind === 'monthly' ? loadMonthlyLines(input.items ?? [], input.force)
    : input.kind === 'payment' ? loadPaymentLines(ids, input.force) : loadPayrollLines(ids, input.force));
  if (input.kind === 'monthly' && lines.length === 0 && problems.length === 0) return { ok: false, status: 400, error: 'nothing_selected' };
  if (problems.length > 0) return { ok: false, status: 422, error: 'invalid_items', problems };

  const file = buildZengin(header, lines);
  try {
    const saved = await saveBatch(input, lines, file);
    return { ok: true, id: saved.id, count: file.count, total: file.total, fileName: saved.fileName };
  } catch (e) {
    if (e instanceof ItemsChanged) return { ok: false, status: 409, error: 'items_changed', message: '他の人が先に処理しました。画面を開き直してください' };
    throw e;
  }
}

export const categoryLabel = (code: string) => CATEGORY_LABEL[code as CategoryCode] ?? code;
