import { describe, it, expect } from 'vitest';
import { bigResponseLine, memLine, memShouldLog, requestKey, slowRequestLine, slowThresholdMs } from '@/lib/slow-requests';

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

describe('リクエストの種類（キー）', () => {
  it('メソッド＋パス。クエリは落とし、IDは :id にまとめる', () => {
    expect(requestKey('GET', '/api/threads/cmowbjbkr0003ve321squ9qxk?x=1')).toBe('GET /api/threads/:id');
  });
  it('静的ファイルは null', () => {
    expect(requestKey('GET', '/_next/static/a.js')).toBeNull();
  });
});

describe('大きな応答の記録', () => {
  const big = (over: Partial<Parameters<typeof bigResponseLine>[0]> = {}) =>
    bigResponseLine({ method: 'GET', url: '/api/threads/cmowbjbkr0003ve321squ9qxk', status: 200, bytes: 36_400_000, thresholdBytes: 3_000_000, ...over });
  it('しきい値以上の応答サイズを、MB で1行に出す', () => {
    expect(big()).toBe('[big] GET /api/threads/:id 200 34.7MB');
  });
  it('しきい値より小さい・サイズ不明（0）・静的ファイルは出さない', () => {
    expect(big({ bytes: 2_999_999 })).toBeNull();
    expect(big({ bytes: 0 })).toBeNull();
    expect(big({ url: '/_next/static/a.js' })).toBeNull();
  });
  it('しきい値が 0 なら無効', () => {
    expect(big({ thresholdBytes: 0 })).toBeNull();
  });
});

describe('メモリの記録', () => {
  const MB = 1024 * 1024;
  const sample = { rss: 255 * MB, heapUsed: 120 * MB, heapTotal: 150 * MB, external: 20 * MB, arrayBuffers: 10 * MB };
  it('メモリの内訳と、その間に多かったリクエストを1行にする', () => {
    const win = new Map([['GET /api/threads', { n: 12, maxMs: 900, maxBytes: 80_000 }], ['GET /api/threads/:id', { n: 3, maxMs: 4000, maxBytes: 36_400_000 }]]);
    expect(memLine(sample, win)).toBe('[mem] rss=255MB heap=120/150MB external=20MB buffers=10MB | GET /api/threads x12 · GET /api/threads/:id x3 (最大34.7MB)');
  });
  it('リクエストが無かった間は、内訳だけ', () => {
    expect(memLine(sample, new Map())).toBe('[mem] rss=255MB heap=120/150MB external=20MB buffers=10MB');
  });
  it('多い順に最大5種類まで', () => {
    const win = new Map(Array.from({ length: 8 }, (_, i) => [`GET /p${i}`, { n: i + 1, maxMs: 1, maxBytes: 1 }] as const));
    const line = memLine(sample, win);
    expect(line).toContain('GET /p7 x8');
    expect(line).not.toContain('GET /p2 ');
    expect(line.split(' · ')).toHaveLength(5);
  });
  it('前回の記録から50MB以上変わったとき、または10分たったとき、最初の1回だけ出す', () => {
    expect(memShouldLog(null, 255, 0)).toBe(true);
    expect(memShouldLog(255, 290, 20_000)).toBe(false);
    expect(memShouldLog(255, 305, 20_000)).toBe(true);
    expect(memShouldLog(300, 240, 20_000)).toBe(true);
    expect(memShouldLog(255, 256, 10 * 60_000)).toBe(true);
  });
});
