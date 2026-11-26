import { describe, it, expect } from 'vitest';
import { buildThreadsWhere, containsWord } from '@/lib/threads-filter';

// 検索の語: 大文字・小文字のない語（漢字・かな・数字）は LIKE（速い）、ある語は ILIKE（大文字・小文字を区別しない）
describe('containsWord', () => {
  it('漢字・かな・数字だけの語は、大文字・小文字を区別しない指定を付けない', () => {
    expect(containsWord('請求')).toEqual({ contains: '請求' });
    expect(containsWord('みつもり')).toEqual({ contains: 'みつもり' });
    expect(containsWord('2026')).toEqual({ contains: '2026' });
    expect(containsWord('10月')).toEqual({ contains: '10月' });
  });
  it('英字（全角の英字も）が入る語は、大文字・小文字を区別しない', () => {
    expect(containsWord('Invoice')).toEqual({ contains: 'Invoice', mode: 'insensitive' });
    expect(containsWord('ｉｎｖｏｉｃｅ')).toEqual({ contains: 'ｉｎｖｏｉｃｅ', mode: 'insensitive' });
    expect(containsWord('請求A')).toEqual({ contains: '請求A', mode: 'insensitive' });
    expect(containsWord('sato@example.com')).toEqual({ contains: 'sato@example.com', mode: 'insensitive' });
  });
});

describe('buildThreadsWhere: 検索の語', () => {
  const where = (q: string) => JSON.stringify(buildThreadsWhere({ session: { userId: 'u1' }, type: 'team', q }));
  it('漢字の語は本文・件名・差出人・宛先を LIKE で探す', () => {
    const w = where('請求');
    expect(w).toContain('"text_body":{"contains":"請求"}');
    expect(w).toContain('"subject":{"contains":"請求"}');
    expect(w).not.toContain('insensitive');
  });
  it('英字の語と from: は、大文字・小文字を区別しない', () => {
    const w = where('Invoice from:Sato');
    expect(w).toContain('"text_body":{"contains":"Invoice","mode":"insensitive"}');
    expect(w).toContain('"from_name":{"contains":"Sato","mode":"insensitive"}');
  });
});
