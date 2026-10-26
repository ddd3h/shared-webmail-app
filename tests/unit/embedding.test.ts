import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  embeddingConfig, buildEmbeddingText, normalize, packVector, unpackVector, similarity, embedTexts, EMBED_MAX_CHARS,
} from '@/lib/embedding';
import { queryText, queryWithoutText } from '@/lib/threads-filter';
import { rankBySimilarity, minSimilarity, DEFAULT_MIN_SIMILARITY } from '@/lib/semantic-search';

afterEach(() => vi.unstubAllGlobals());

describe('embeddingConfig', () => {
  it('EMBEDDING_API_URL がなければ無効（メールを外に送らない）', () => {
    expect(embeddingConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(embeddingConfig({ EMBEDDING_API_URL: '  ' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it('末尾のスラッシュを除き、モデルと次元の既定値を持つ', () => {
    const c = embeddingConfig({ EMBEDDING_API_URL: 'http://localhost:11434/v1/' } as unknown as NodeJS.ProcessEnv)!;
    expect(c).toEqual({ url: 'http://localhost:11434/v1', key: null, model: 'text-embedding-3-small', dims: null });
    const d = embeddingConfig({ EMBEDDING_API_URL: 'https://x', EMBEDDING_API_KEY: 'k', EMBEDDING_MODEL: 'm', EMBEDDING_DIMENSIONS: '512' } as unknown as NodeJS.ProcessEnv)!;
    expect(d).toMatchObject({ key: 'k', model: 'm', dims: 512 });
  });
});

describe('buildEmbeddingText', () => {
  it('件名のあとに本文を並べる', () => {
    expect(buildEmbeddingText('見積の件', ['お世話になります。\n見積をお送りします'])).toBe('見積の件\nお世話になります。 見積をお送りします');
  });
  it('引用（> で始まる行）は含めない', () => {
    expect(buildEmbeddingText('Re: 会議', ['了解です\n> 昨日の会議の件ですが\n> 来週にしませんか'])).toBe('Re: 会議\n了解です');
  });
  it('長いやりとりは切り詰める', () => {
    const t = buildEmbeddingText('件名', ['あ'.repeat(5000), 'い'.repeat(5000), 'う'.repeat(5000)]);
    expect(t.length).toBeLessThanOrEqual(EMBED_MAX_CHARS);
  });
  it('本文がなくても件名だけで作れる', () => {
    expect(buildEmbeddingText('件名だけ', [null, undefined, ''])).toBe('件名だけ');
  });
});

describe('ベクトル', () => {
  it('正規化すると長さが1になる', () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });
  it('ゼロベクトルでも壊れない', () => {
    expect(Array.from(normalize([0, 0]))).toEqual([0, 0]);
  });
  it('保存して読み戻しても同じ', () => {
    const v = normalize([1, -2, 3.5, 0.25]);
    const back = unpackVector(packVector(v));
    expect(Array.from(back)).toEqual(Array.from(v));
  });
  it('似た向きほど類似度が高く、直交は0、次元違いは0', () => {
    const a = normalize([1, 0]);
    expect(similarity(a, normalize([1, 0]))).toBeCloseTo(1);
    expect(similarity(a, normalize([1, 1]))).toBeCloseTo(0.707, 2);
    expect(similarity(a, normalize([0, 1]))).toBeCloseTo(0);
    expect(similarity(a, normalize([1, 0, 0]))).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  const q = normalize([1, 0]);
  const cands = [
    { id: 'far', vector: normalize([0, 1]) },
    { id: 'near', vector: normalize([1, 0.1]) },
    { id: 'mid', vector: normalize([1, 1]) },
  ];
  it('近い順に並べ、しきい値未満は落とす', () => {
    expect(rankBySimilarity(q, cands, 0.5, 10).map(r => r.id)).toEqual(['near', 'mid']);
  });
  it('件数を絞れる', () => {
    expect(rankBySimilarity(q, cands, 0, 1).map(r => r.id)).toEqual(['near']);
  });
  it('しきい値は環境変数で変えられ、不正な値は既定に戻る', () => {
    expect(minSimilarity({ EMBEDDING_MIN_SCORE: '0.45' } as unknown as NodeJS.ProcessEnv)).toBe(0.45);
    expect(minSimilarity({ EMBEDDING_MIN_SCORE: 'abc' } as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_MIN_SIMILARITY);
    expect(minSimilarity({} as NodeJS.ProcessEnv)).toBe(DEFAULT_MIN_SIMILARITY);
  });
});

describe('検索語の分け方', () => {
  it('自由な言葉だけを意味検索に使い、from: などは絞り込みに残す', () => {
    expect(queryText('請求書 from:佐藤 支払い status:完了')).toBe('請求書 支払い');
    expect(queryWithoutText('請求書 from:佐藤 支払い status:完了')).toBe('from:佐藤 status:完了');
  });
  it('言葉がなければ空', () => {
    expect(queryText('from:a@b.c has:attachment')).toBe('');
  });
});

describe('embedTexts', () => {
  const cfg = { url: 'http://emb.test/v1', key: 'secret', model: 'm', dims: null };
  it('設定がなければ使えない', async () => {
    await expect(embedTexts(['a'], null)).rejects.toThrow('embedding_disabled');
  });
  it('index 順に並べ直し、正規化して返す。キーは Authorization で送る', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 0] }] })));
    vi.stubGlobal('fetch', fetchMock);
    const out = await embedTexts(['a', 'b'], cfg);
    expect(Array.from(out[0])).toEqual([1, 0]);
    expect(Array.from(out[1])).toEqual([0, 1]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://emb.test/v1/embeddings');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });
  it('たくさんの文は小分けにして送る', async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(init.body as string).input as string[]).length;
      return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [1, 1] })) }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await embedTexts(Array.from({ length: 40 }, (_, i) => `t${i}`), cfg);
    expect(out).toHaveLength(40);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('サービスが失敗したら例外にする（呼び出し側がキーワード検索に戻す）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    await expect(embedTexts(['a'], cfg)).rejects.toThrow('embedding_http_500');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    await expect(embedTexts(['a'], cfg)).rejects.toThrow('embedding_bad_response');
  });
});
