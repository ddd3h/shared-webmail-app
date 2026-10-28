// Pure helpers for bank transfer requests (no I/O so they are easy to test and usable in the browser).

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type AccountType = 'ordinary' | 'checking' | 'savings';
export type FeeBearer = 'us' | 'vendor';

export const STATUS_LABEL: Record<PaymentStatus, string> = { pending: '承認待ち', approved: '振込待ち', rejected: '却下', paid: '振込済' };
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { ordinary: '普通', checking: '当座', savings: '貯蓄' };
export const FEE_BEARER_LABEL: Record<FeeBearer, string> = { us: '当方負担', vendor: '先方負担（振込額から差引）' };

export const MAX_AMOUNT = 1_000_000_000;
export const MAX_DOCUMENTS = 5;

// What actually leaves the bank account for the payee.
export function transferAmount(r: { amount: number; deduction_amount: number; fee: number; fee_bearer: string }): number {
  return r.amount - r.deduction_amount - (r.fee_bearer === 'vendor' ? r.fee : 0);
}

// Deductions + a payee-borne fee must not exceed the invoice amount.
export function isValidBreakdown(r: { amount: number; deduction_amount: number; fee: number; fee_bearer: string }): boolean {
  return transferAmount(r) >= 0;
}

export function isValidAccountNumber(s: string): boolean {
  return /^\d{4,8}$/.test(s);
}

export const last4 = (accountNumber: string) => accountNumber.slice(-4);

// 「●●●●1234」 style display for people who may not see the full number.
export const maskAccount = (l4: string) => `●●●${l4}`;

// Is `due` (YYYY-MM-DD) before `today`? Used to flag overdue transfers.
export const isOverdue = (due: string, today: string) => due < today;

// ---- CSV for the bank / accounting (opened in Excel, so guard against formula injection) ----
function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
