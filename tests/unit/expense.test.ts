import { describe, it, expect } from 'vitest';
import { isEditable, isReceiptType, isReimbursable, summarize } from '@/lib/expense';

describe('isReimbursable', () => {
  it('承認済みの立替だけが返金対象', () => {
    expect(isReimbursable({ status: 'approved', payment_method: 'personal' })).toBe(true);
    expect(isReimbursable({ status: 'approved', payment_method: 'company' })).toBe(false);
    expect(isReimbursable({ status: 'pending', payment_method: 'personal' })).toBe(false);
    expect(isReimbursable({ status: 'paid', payment_method: 'personal' })).toBe(false);
  });
});

describe('isEditable', () => {
  it('承認待ちと却下だけ編集できる', () => {
    expect(['pending', 'rejected', 'approved', 'paid'].map(status => isEditable({ status }))).toEqual([true, true, false, false]);
  });
});

describe('isReceiptType', () => {
  it('画像とPDFのみ許可する', () => {
    expect(isReceiptType('image/png')).toBe(true);
    expect(isReceiptType('application/pdf')).toBe(true);
    expect(isReceiptType('text/html')).toBe(false);
    expect(isReceiptType('image/svg+xml')).toBe(false);
  });
});

describe('summarize', () => {
  it('承認待ち・返金待ち・返金済を集計する', () => {
    const s = summarize([
      { status: 'pending', payment_method: 'personal', amount: 1000 },
      { status: 'approved', payment_method: 'personal', amount: 2500 },
      { status: 'approved', payment_method: 'personal', amount: 500 },
      { status: 'approved', payment_method: 'company', amount: 9999 },
      { status: 'paid', payment_method: 'personal', amount: 700 },
      { status: 'rejected', payment_method: 'personal', amount: 300 },
    ]);
    expect(s).toEqual({
      pending: { count: 1, amount: 1000 },
      to_reimburse: { count: 2, amount: 3000 },
      paid: { count: 1, amount: 700 },
    });
  });
});
