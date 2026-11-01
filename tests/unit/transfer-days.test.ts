import { describe, expect, it } from 'vitest';
import { slotOfDate, transferSlotFor, transferSlotLabel } from '@/lib/transfer-days';

// 2026-11-15 is a Sunday (-> Fri 13th), 2026-11-25 a Wednesday, 2026-10-25 a Sunday (-> Fri 23rd), 2026-12-15 a Tuesday.
describe('transferSlotFor（振込申請の振込日: 15日・25日の月2回）', () => {
  it('期日に間に合う一番遅い振込日になる', () => {
    expect(transferSlotFor('2026-11-30', '2026-11-02')).toEqual({ date: '2026-11-25', day: 25, late: false });
    expect(transferSlotFor('2026-11-25', '2026-11-02')).toEqual({ date: '2026-11-25', day: 25, late: false });
    expect(transferSlotFor('2026-11-24', '2026-11-02')).toEqual({ date: '2026-11-13', day: 15, late: false });
  });
  it('土日にあたる振込日は、前の平日に早める', () => {
    expect(transferSlotFor('2026-11-20', '2026-11-02')).toEqual({ date: '2026-11-13', day: 15, late: false });
    expect(transferSlotFor('2026-10-31', '2026-10-01')).toEqual({ date: '2026-10-23', day: 25, late: false });
  });
  it('今日より前の振込日は選ばない。間に合うものがなければ次の振込日（期日に遅れる）', () => {
    expect(transferSlotFor('2026-11-20', '2026-11-14')).toEqual({ date: '2026-11-25', day: 25, late: true });
    expect(transferSlotFor('2026-11-10', '2026-11-05')).toEqual({ date: '2026-11-13', day: 15, late: true });
  });
  it('期日が過ぎていても、次の振込日になる', () => {
    expect(transferSlotFor('2026-10-01', '2026-11-26')).toEqual({ date: '2026-12-15', day: 15, late: true });
  });
  it('今日が振込日なら、今日の分に間に合う', () => {
    expect(transferSlotFor('2026-11-30', '2026-11-25')).toEqual({ date: '2026-11-25', day: 25, late: false });
  });
  it('月をまたぐ（期日が翌月の頭でも、今月の25日に間に合わせる）', () => {
    expect(transferSlotFor('2026-12-03', '2026-11-26')).toEqual({ date: '2026-12-15', day: 15, late: true });
    expect(transferSlotFor('2026-12-03', '2026-11-20')).toEqual({ date: '2026-11-25', day: 25, late: false });
    expect(transferSlotFor('2027-01-05', '2026-12-26')).toEqual({ date: '2027-01-15', day: 15, late: true });
  });
});

describe('slotOfDate / transferSlotLabel', () => {
  it('振込日の日付は15日・25日に戻せる（土日で早めた日も）', () => {
    expect(slotOfDate('2026-11-13')).toBe(15);
    expect(slotOfDate('2026-11-25')).toBe(25);
    expect(slotOfDate('2026-10-23')).toBe(25);
    expect(slotOfDate('2026-11-20')).toBeNull();
  });
  it('表示用の文字', () => {
    expect(transferSlotLabel({ date: '2026-11-13', day: 15, late: false })).toBe('11/13（15日振込）');
  });
});
