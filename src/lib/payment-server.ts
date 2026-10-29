// DB-side helpers shared by the payment routes.
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { maskAccount, transferAmount, type AccountType } from '@/lib/payment';
import { transferSlotFor } from '@/lib/transfer-days';
import { jstDateString } from '@/lib/work';

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// Everybody sees who the payee is and a masked account; only admins see the full bank details.
export async function serializeVendor(v: any, admin: boolean) {
  const base = {
    id: v.id, name: v.name, name_kana: v.name_kana, bank_name: v.bank_name, branch_name: v.branch_name,
    account_type: v.account_type as AccountType, account_masked: maskAccount(v.account_last4),
    is_active: v.is_active, verified: !!v.verified_at, verified_at: v.verified_at,
  };
  if (!admin) return base;
  let account_number = '';
  try { account_number = await decrypt(v.account_number_enc); } catch { /* unreadable: show nothing rather than fail the list */ }
  return { ...base, bank_code: v.bank_code, branch_code: v.branch_code, account_number, account_holder: v.account_holder, notes: v.notes };
}

export const requestInclude = {
  user: { select: { id: true, name: true } },
  reviewer: { select: { name: true } },
  vendor: true,
  documents: { select: { id: true, filename: true, content_type: true, size: true }, orderBy: { created_at: 'asc' as const } },
};

export async function serializeRequest(r: any, admin: boolean) {
  // paid / rejected ones have no planned transfer day; the others get the 15日 or 25日 that fits their due date
  const slot = r.status === 'pending' || r.status === 'approved' ? transferSlotFor(ymd(r.due_date)!, jstDateString(new Date())) : null;
  return {
    id: r.id,
    user: r.user,
    vendor: await serializeVendor(r.vendor, admin),
    title: r.title,
    amount: r.amount,
    deduction_amount: r.deduction_amount,
    fee: r.fee,
    fee_bearer: r.fee_bearer,
    transfer_amount: transferAmount(r),
    invoice_number: r.invoice_number,
    invoice_date: ymd(r.invoice_date),
    due_date: ymd(r.due_date),
    transfer_date: slot?.date ?? null, transfer_day: slot?.day ?? null, transfer_late: slot?.late ?? false,
    description: r.description,
    batch_id: r.batch_id ?? null,
    status: r.status,
    reviewer: r.reviewer?.name ?? null,
    reviewed_at: r.reviewed_at,
    review_comment: r.review_comment,
    paid_at: ymd(r.paid_at),
    paid_note: r.paid_note,
    documents: r.documents,
  };
}
