// Pure helpers for expense claims (no I/O so they are easy to test).

export const EXPENSE_CATEGORIES = ['交通費', '出張・宿泊費', '交際費', '会議費', '消耗品費', '通信費', '書籍・研修費', 'その他'] as const;

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

type Claim = { status: string; payment_method: string; amount: number };

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
    to_reimburse: sum(isReimbursable),
    paid: sum(c => c.status === 'paid'),
  };
}
