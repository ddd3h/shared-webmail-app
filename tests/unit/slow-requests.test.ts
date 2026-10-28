import { describe, it, expect } from 'vitest';
import { slowRequestLine, slowThresholdMs } from '@/lib/slow-requests';

const line = (over: Partial<Parameters<typeof slowRequestLine>[0]> = {}) =>
  slowRequestLine({ method: 'GET', url: '/api/threads', status: 200, ms: 1234.6, thresholdMs: 500, ...over });

describe('遅いリクエストの記録', () => {
  it('しきい値以上かかったリクエストを、1行で出す', () => {
    expect(line()).toBe('[slow] GET /api/threads 200 1235ms');
  });

  it('しきい値より速いものは出さない', () => {
    expect(line({ ms: 499 })).toBeNull();
    expect(line({ ms: 500 })).not.toBeNull();
  });

  it('しきい値が 0 なら何も出さない（無効）', () => {
    expect(line({ thresholdMs: 0, ms: 99999 })).toBeNull();
  });

  it('検索語やメールアドレスが入りうるクエリ文字列は、記録に残さない', () => {
    expect(line({ url: '/api/threads?q=secret%40example.com&status=open' })).toBe('[slow] GET /api/threads 200 1235ms');
  });

  it('スレッドIDなどは :id にまとめて、同じ API を数えやすくする', () => {
    expect(line({ url: '/api/threads/cmowbjbkr0003ve321squ9qxk/messages' })).toBe('[slow] GET /api/threads/:id/messages 200 1235ms');
  });

  it('静的ファイルは遅くても出さない', () => {
    expect(line({ url: '/_next/static/chunks/app.js' })).toBeNull();
    expect(line({ url: '/sw.js' })).toBeNull();
  });
});

describe('しきい値の設定（SLOW_REQUEST_MS）', () => {
  it('未設定なら 500ms', () => {
    expect(slowThresholdMs(undefined)).toBe(500);
    expect(slowThresholdMs('')).toBe(500);
  });

  it('数字ならその値、0 なら無効', () => {
    expect(slowThresholdMs('800')).toBe(800);
    expect(slowThresholdMs('0')).toBe(0);
  });

  it('数字でない・負の値は既定に戻す', () => {
    expect(slowThresholdMs('abc')).toBe(500);
    expect(slowThresholdMs('-5')).toBe(500);
  });
});
