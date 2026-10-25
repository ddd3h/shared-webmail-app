// Builds 全銀 transfer files from approved payment requests or pay statements and records them as batches.
//
// Flow of createBatch: check the company settings → turn every id into a line (or a problem) → refuse if any
// problem → build the file → save it and claim the items in ONE transaction.
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { transferAmount } from '@/lib/payment';
import { payslipTotals, jstDateString } from '@/lib/work';
import { CATEGORY_LABEL, buildZengin, validateHeader, validateRow, type CategoryCode, type ZenginRow } from '@/lib/zengin';
import { loadZenginSettings, toHeader } from '@/lib/zengin-settings';

export type Problem = { id: string; label: string; reason: string };
type Line = ZenginRow & { id: string; label: string };
type Kind = 'payment' | 'payroll';
type Loaded = { lines: Line[]; problems: Problem[] };

export type CreateInput = { kind: Kind; ids: string[]; category: CategoryCode; transferDate: string; force: boolean; actorId: string };
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
  const { lines, problems } = await (input.kind === 'payment' ? loadPaymentLines(ids, input.force) : loadPayrollLines(ids, input.force));
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
