import { describe, it, expect, vi, beforeEach } from 'vitest';

const pipeline = vi.hoisted(() => vi.fn());
const tfEnv = vi.hoisted(() => ({ cacheDir: '', allowRemoteModels: true }));
vi.mock('@huggingface/transformers', () => ({ pipeline, env: tfEnv }));

import { embedLocal } from '@/lib/embedding-local';

const cfg = { kind: 'local' as const, model: 'Xenova/test-e5', dims: null, cacheDir: '/data/models', localOnly: false };

beforeEach(() => {
  pipeline.mockReset();
  tfEnv.cacheDir = ''; tfEnv.allowRemoteModels = true;
  (globalThis as { __embeddingExtractor?: unknown }).__embeddingExtractor = undefined;
});

describe('embedLocal', () => {
  it('モデルは1度だけ読み込み、8件ずつ処理して、正規化済みの結果を返す', async () => {
    const extractor = vi.fn(async (texts: string[], _opts?: unknown) => ({ tolist: () => texts.map(() => [1, 0, 0]) }));
    pipeline.mockResolvedValue(extractor);
    const out = await embedLocal(Array.from({ length: 20 }, (_, i) => `t${i}`), cfg);
    expect(out).toHaveLength(20);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(extractor).toHaveBeenCalledTimes(3);
    expect(extractor.mock.calls[0][1]).toEqual({ pooling: 'mean', normalize: true });
    await embedLocal(['x'], cfg);
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/test-e5', { dtype: 'q8' });
    expect(tfEnv.cacheDir).toBe('/data/models');
  });
  it('EMBEDDING_LOCAL_ONLY ならダウンロードを許さない', async () => {
    pipeline.mockResolvedValue(async () => ({ tolist: () => [[1]] }));
    await embedLocal(['a'], { ...cfg, localOnly: true });
    expect(tfEnv.allowRemoteModels).toBe(false);
  });
  it('読み込みに失敗しても覚えず、次の呼び出しでやり直す', async () => {
    pipeline.mockRejectedValueOnce(new Error('no network'));
    await expect(embedLocal(['a'], cfg)).rejects.toThrow('no network');
    await new Promise(r => setTimeout(r, 0));
    pipeline.mockResolvedValueOnce(async () => ({ tolist: () => [[1]] }));
    expect(await embedLocal(['a'], cfg)).toHaveLength(1);
    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});
