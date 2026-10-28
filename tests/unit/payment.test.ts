import { describe, it, expect } from 'vitest';
import { isOverdue, isValidAccountNumber, isValidBreakdown, last4, maskAccount, toCsv, transferAmount } from '@/lib/payment';

describe('transferAmount', () => {
  it('請求額から控除を引く', () => {
    expect(transferAmount({ amount: 110000, deduction_amount: 11226, fee: 0, fee_bearer: 'us' })).toBe(98774);
  });
  it('振込手数料は先方負担のときだけ差し引く', () => {
    expect(transferAmount({ amount: 100000, deduction_amount: 0, fee: 440, fee_bearer: 'vendor' })).toBe(99560);
    expect(transferAmount({ amount: 100000, deduction_amount: 0, fee: 440, fee_bearer: 'us' })).toBe(100000);
  });
  it('控除と先方負担手数料の合計が請求額を超えると不正', () => {
    expect(isValidBreakdown({ amount: 1000, deduction_amount: 800, fee: 300, fee_bearer: 'vendor' })).toBe(false);
    expect(isValidBreakdown({ amount: 1000, deduction_amount: 800, fee: 300, fee_bearer: 'us' })).toBe(true);
    expect(isValidBreakdown({ amount: 1000, deduction_amount: 1000, fee: 0, fee_bearer: 'us' })).toBe(true);
  });
});

describe('口座番号', () => {
  it('4〜8桁の数字のみ', () => {
    expect(isValidAccountNumber('1234567')).toBe(true);
    expect(isValidAccountNumber('123')).toBe(false);
    expect(isValidAccountNumber('123456789')).toBe(false);
    expect(isValidAccountNumber('12a4567')).toBe(false);
  });
  it('末尾4桁だけを表示用に使う', () => {
    expect(last4('1234567')).toBe('4567');
    expect(maskAccount('4567')).toBe('●●●4567');
  });
});

describe('期日', () => {
  it('期日が今日より前なら期限超過', () => {
    expect(isOverdue('2026-10-24', '2026-10-25')).toBe(true);
    expect(isOverdue('2026-10-25', '2026-10-25')).toBe(false);
  });
});

describe('toCsv', () => {
  it('BOM付きで、カンマ・引用符・改行をエスケープする', () => {
    const csv = toCsv([['a', 'b,c', 'd"e', 'f\ng'], [1, null, undefined, 0]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('a,"b,c","d""e","f\ng"\r\n');
    expect(csv).toContain('1,,,0\r\n');
  });
  it('数式として解釈される先頭文字は無効化する（数値は対象外）', () => {
    const csv = toCsv([['=HYPERLINK("http://evil")', '+1', '-1', '@x', 'ok'], [-500]]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(",'+1,'-1,'@x,ok");
    expect(csv).toContain('-500\r\n');
  });
});
