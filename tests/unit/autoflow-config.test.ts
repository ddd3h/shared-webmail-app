import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, configSchema, parseConfig } from '@/lib/autoflow/config';

describe('オートフローの設定', () => {
  it('何も保存されていなければ、すべて OFF', () => {
    for (const raw of [null, undefined, '']) expect(parseConfig(raw)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.report.enabled).toBe(false);
    expect(DEFAULT_CONFIG.expense).toEqual({ enabled: false, days_before: 3 });
    expect(DEFAULT_CONFIG.payment).toEqual({ enabled: false, days_before: 3 });
    expect(DEFAULT_CONFIG.confirm).toEqual({ enabled: false });
    expect(DEFAULT_CONFIG.fixed_pay).toEqual({ enabled: false });
    expect(DEFAULT_CONFIG.activity).toEqual({ enabled: false, days: 14 });
  });

  it('壊れた保存値は、すべて OFF の既定値に戻す（誤って通知が飛ばない）', () => {
    expect(parseConfig('{oops')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('{"expense":{"enabled":true,"days_before":999}}')).toEqual(DEFAULT_CONFIG);
  });

  it('一部だけ保存されていても、足りないところは既定値で補う', () => {
    expect(parseConfig('{"expense":{"enabled":true}}').expense).toEqual({ enabled: true, days_before: 3 });
  });

  it('日数は範囲の中だけ受け付ける', () => {
    expect(configSchema.safeParse({ expense: { enabled: true, days_before: 0 } }).success).toBe(false);
    expect(configSchema.safeParse({ payment: { enabled: true, days_before: 15 } }).success).toBe(false);
    expect(configSchema.safeParse({ payment: { enabled: true, days_before: 7 } }).success).toBe(true);
  });
});
