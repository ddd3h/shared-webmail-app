// Builds 全銀 transfer files from approved payment requests or pay statements and records them as batches.
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { transferAmount } from '@/lib/payment';
import { payslipTotals, jstDateString } from '@/lib/work';
import { CATEGORY_LABEL, buildZengin, validateHeader, validateRow, type CategoryCode, type ZenginRow } from '@/lib/zengin';
import { loadZenginSettings, toHeader } from '@/lib/zengin-settings';

export type Problem = { id: string; label: string; reason: string };
type Row = ZenginRow & { id: string; label: string };

export type CreateInput = {
  kind: 'payment' | 'payroll'; ids: string[]; category: CategoryCode; transferDate: string; force: boolean; actorId: string;
};
export type CreateResult =
  | { ok: true; id: string; count: number; total: number; fileName: string }
  | { ok: false; status: number; error: string; message?: string; problems?: Problem[] };

export function isValidTransferDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) return false;
  const today = jstDateString(new Date());
  const limit = jstDateString(new Date(Date.now() + 60 * 86400_000));
  return s >= today && s <= limit; // a bank can't execute a transfer dated in the past
}

const batched = (id: string | null, force: boolean): string | null =>
  id && !force ? '作成済みの全銀データに含まれています（二重振込の防止）。作り直す場合は「作成済みも含める」を選んでください' : null;

async function paymentRows(ids: string[], force: boolean): Promise<{ rows: Row[]; problems: Problem[] }> {
  const found = await prisma.payment_requests.findMany({ where: { id: { in: ids } }, include: { vendor: true } });
  const rows: Row[] = []; const problems: Problem[] = [];
  for (const id of ids) {
    const r = found.find(x => x.id === id);
    if (!r) { problems.push({ id, label: id, reason: '申請が見つかりません' }); continue; }
    const label = `${r.vendor.name} 宛「${r.title}」`;
    const reason =
      r.status !== 'approved' ? '承認済み（振込待ち）ではありません' :
      !r.vendor.verified_at ? '振込先の口座が未確認です' :
      batched(r.batch_id, force);
    if (reason) { problems.push({ id, label, reason }); continue; }
    const row: Row = {
      id, label, bankCode: r.vendor.bank_code ?? '', bankName: r.vendor.bank_name, branchCode: r.vendor.branch_code ?? '', branchName: r.vendor.branch_name,
      accountType: r.vendor.account_type as ZenginRow['accountType'], accountNumber: await decrypt(r.vendor.account_number_enc).catch(() => ''),
      holder: r.vendor.account_holder, amount: transferAmount(r),
    };
    const bad = validateRow(row);
    if (bad) problems.push({ id, label, reason: bad }); else rows.push(row);
  }
  return { rows, problems };
}

async function payrollRows(ids: string[], force: boolean): Promise<{ rows: Row[]; problems: Problem[] }> {
  const found = await prisma.payslips.findMany({ where: { id: { in: ids } }, include: { items: true, user: { include: { bank_account: true } } } });
  const rows: Row[] = []; const problems: Problem[] = [];
  for (const id of ids) {
    const p = found.find(x => x.id === id);
    if (!p) { problems.push({ id, label: id, reason: '明細が見つかりません' }); continue; }
    const label = `${p.user.name} ${p.pay_month} ${p.title}`;
    const acct = p.user.bank_account;
    const net = payslipTotals(p.items).net;
    const reason =
      p.status !== 'planned' ? '支払予定の明細ではありません（支払済み）' :
      !acct ? '受取口座が登録されていません' :
      !acct.verified_at ? '受取口座が未確認です' :
      batched(p.batch_id, force);
    if (reason) { problems.push({ id, label, reason }); continue; }
    const row: Row = {
      id, label, bankCode: acct!.bank_code, bankName: acct!.bank_name, branchCode: acct!.branch_code, branchName: acct!.branch_name,
      accountType: acct!.account_type as ZenginRow['accountType'], accountNumber: await decrypt(acct!.account_number_enc).catch(() => ''),
      holder: acct!.account_holder, amount: net,
    };
    const bad = validateRow(row);
    if (bad) problems.push({ id, label, reason: bad }); else rows.push(row);
  }
  return { rows, problems };
}

// All or nothing: one unusable line means no file, so a half-filled file can never be uploaded to the bank by mistake.
export async function createBatch(input: CreateInput): Promise<CreateResult> {
  const settings = await loadZenginSettings();
  const header = toHeader(settings, input.category, input.transferDate);
  const headerProblem = validateHeader(header);
  if (headerProblem) return { ok: false, status: 422, error: 'zengin_settings', message: `全銀の設定（委託者情報）を確認してください: ${headerProblem}` };

  const ids = [...new Set(input.ids)];
  const { rows, problems } = input.kind === 'payment' ? await paymentRows(ids, input.force) : await payrollRows(ids, input.force);
  if (problems.length > 0) return { ok: false, status: 422, error: 'invalid_items', problems };

  const file = buildZengin(header, rows);
  const stamp = `${input.transferDate.replace(/-/g, '')}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
  const fileName = `zengin-${input.kind === 'payment' ? 'payment' : 'payroll'}-${stamp}.txt`;

  const batch = await prisma.$transaction(async tx => {
    const b = await tx.transfer_batches.create({
      data: {
        kind: input.kind, category_code: input.category, transfer_date: new Date(`${input.transferDate}T00:00:00Z`), item_count: file.count,
        total_amount: file.total, file_name: fileName, content_b64: Buffer.from(file.bytes).toString('base64'), created_by_id: input.actorId,
      },
    });
    if (input.kind === 'payment') await tx.payment_requests.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { batch_id: b.id } });
    else await tx.payslips.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { batch_id: b.id } });
    return b;
  });
  return { ok: true, id: batch.id, count: file.count, total: file.total, fileName };
}

export const categoryLabel = (code: string) => CATEGORY_LABEL[code as CategoryCode] ?? code;
