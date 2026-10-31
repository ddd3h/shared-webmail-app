import { describe, expect, it } from 'vitest';
import { isRecent, provedAt } from '@/lib/reauth';

const MIN = 60_000;
const now = 1_000_000_000_000;

describe('provedAt / isRecent（直近にパスワードで確かめたか）', () => {
  it('ログインした時刻が、最後に確かめた時刻になる。入れ直すと、その時刻になる', () => {
    expect(provedAt({ issuedAt: now - 30 * MIN })).toBe(now - 30 * MIN);
    expect(provedAt({ issuedAt: now - 30 * MIN, reauthAt: now - 2 * MIN })).toBe(now - 2 * MIN);
    expect(provedAt({ issuedAt: now - 5 * MIN, reauthAt: now - 20 * MIN })).toBe(now - 5 * MIN);
  });
  it('設定の分数以内なら通り、超えると通らない（ちょうどの時刻は通る）', () => {
    expect(isRecent({ issuedAt: now - 14 * MIN }, 15, now)).toBe(true);
    expect(isRecent({ issuedAt: now - 15 * MIN }, 15, now)).toBe(true);
    expect(isRecent({ issuedAt: now - 15 * MIN - 1 }, 15, now)).toBe(false);
    expect(isRecent({ issuedAt: now - 15 * MIN - 1, reauthAt: now - MIN }, 15, now)).toBe(true);
  });
  it('0分は「求めない」', () => {
    expect(isRecent({ issuedAt: now - 1000 * MIN }, 0, now)).toBe(true);
    expect(isRecent({}, 0, now)).toBe(true);
  });
  it('端末の鍵で入り直したセッション（resumed）は、パスワードを入れたことにならない。入れ直したときだけ数える', () => {
    expect(isRecent({ issuedAt: now, resumed: true }, 15, now)).toBe(false);
    expect(provedAt({ issuedAt: now, resumed: true })).toBe(0);
    expect(isRecent({ issuedAt: now - 60 * MIN, resumed: true, reauthAt: now - MIN }, 15, now)).toBe(true);
  });
  it('時刻が分からないセッションは、通らない', () => {
    expect(isRecent({}, 15, now)).toBe(false);
  });
});
