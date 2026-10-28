import { describe, it, expect } from 'vitest';
import { MAX_PASSKEYS, canRegisterPasskey, needsPasskeyCleanup, passwordLoginAllowed, daysSince, lastLoginLabel, latestDate } from '@/lib/passkey-policy';

describe('パスキーを登録した人のログイン方法', () => {
  it('パスキーが1つもない人だけが、パスワードで入れる', () => {
    expect(passwordLoginAllowed(0)).toBe(true);
    expect(passwordLoginAllowed(1)).toBe(false);
    expect(passwordLoginAllowed(2)).toBe(false);
  });
});

describe('パスキーは一人1つまで', () => {
  it('上限は1', () => {
    expect(MAX_PASSKEYS).toBe(1);
  });
  it('0個のときだけ新しく登録できる', () => {
    expect(canRegisterPasskey(0)).toBe(true);
    expect(canRegisterPasskey(1)).toBe(false);
    expect(canRegisterPasskey(2)).toBe(false);
  });
  it('2つ以上ある人には、1つにするよう促す（1つ以下は促さない）', () => {
    expect(needsPasskeyCleanup(0)).toBe(false);
    expect(needsPasskeyCleanup(1)).toBe(false);
    expect(needsPasskeyCleanup(2)).toBe(true);
    expect(needsPasskeyCleanup(5)).toBe(true);
  });
});

describe('最終ログイン', () => {
  const now = new Date('2026-10-28T12:00:00+09:00');
  it('日数は、経過した丸1日ごとに数える', () => {
    expect(daysSince(new Date('2026-10-28T03:00:00+09:00'), now)).toBe(0);
    expect(daysSince(new Date('2026-10-27T11:59:00+09:00'), now)).toBe(1);
    expect(daysSince(new Date('2026-09-28T12:00:00+09:00'), now)).toBe(30);
  });
  it('一度もログインしていない人は null', () => {
    expect(daysSince(null, now)).toBeNull();
  });
  it('表示用の文言: 今日・N日前・未ログイン', () => {
    expect(lastLoginLabel(new Date('2026-10-28T09:00:00+09:00'), now)).toBe('今日');
    expect(lastLoginLabel(new Date('2026-10-25T12:00:00+09:00'), now)).toBe('3日前');
    expect(lastLoginLabel(null, now)).toBe('ログイン記録なし');
  });
  it('2つの日時のうち新しい方を選ぶ（片方が null でもよい）', () => {
    const a = new Date('2026-10-01'), b = new Date('2026-10-20');
    expect(latestDate(a, b)).toEqual(b);
    expect(latestDate(b, a)).toEqual(b);
    expect(latestDate(null, a)).toEqual(a);
    expect(latestDate(a, null)).toEqual(a);
    expect(latestDate(null, null)).toBeNull();
  });
});
