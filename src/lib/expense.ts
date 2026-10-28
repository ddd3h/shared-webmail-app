// Pure helpers for expense claims (no I/O so they are easy to test).
import { isBonusTitle } from '@/lib/work';

export const EXPENSE_CATEGORIES = ['交通費', '自家用車', '出張・宿泊費', '交際費', '会議費', '消耗品費', '通信費', '書籍・研修費', 'その他'] as const;
/** The category whose amount is worked out from the distance (src/lib/mileage.ts), not typed in. */
export const MILEAGE_CATEGORY = '自家用車';

export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type PaymentMethod = 'personal' | 'company';

export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  pending: '承認待ち',
  approved: '承認済',
  rejected: '却下',
  paid: '返金済',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { personal: '立替', company: '会社負担' };

export const MAX_RECEIPTS = 5;
export const MAX_AMOUNT = 100_000_000;

// Receipts are images or PDFs only; they are always served as downloads.
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf'];

export function isReceiptType(t: string) {
  return RECEIPT_TYPES.includes(t);
}

type Claim = { status: string; payment_method: string; amount: number; payslip_id?: string | null };

// An approved out-of-pocket claim that has not been paid back yet.
export function isReimbursable(c: Pick<Claim, 'status' | 'payment_method'>) {
  return c.status === 'approved' && c.payment_method === 'personal';
}

// Only pending or rejected (resubmit) claims may be edited by the claimant.
export function isEditable(c: Pick<Claim, 'status'>) {
  return c.status === 'pending' || c.status === 'rejected';
}

export function summarize(claims: Claim[]) {
  const sum = (f: (c: Claim) => boolean) => {
    const rows = claims.filter(f);
    return { count: rows.length, amount: rows.reduce((s, c) => s + c.amount, 0) };
  };
  return {
    pending: sum(c => c.status === 'pending'),
    // approved out-of-pocket claims nobody has dealt with yet
    to_reimburse: sum(c => isReimbursable(c) && !c.payslip_id),
    // merged into a pay statement that has not been paid yet
    in_payslip: sum(c => isReimbursable(c) && !!c.payslip_id),
    paid: sum(c => c.status === 'paid'),
  };
}

// Which of a person's pay statements for the month receives the reimbursement:
// an unpaid statement titled 給与 if there is one, otherwise the oldest unpaid one that is not a 賞与
// (a bonus is paid in its own 全銀 category; mixing a reimbursement into it would be paid as a bonus).
export function pickPayslip<T extends { title: string; status: string }>(candidates: T[]): T | undefined {
  const open = candidates.filter(p => p.status === 'planned');
  return open.find(p => p.title === '給与') ?? open.find(p => !isBonusTitle(p.title));
}

export const EXPENSE_ITEM_KEY = 'expense_reimbursement';
export const EXPENSE_ITEM_LABEL = '立替金精算';
