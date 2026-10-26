import path from 'path';
import type { EmbeddingConfig } from '@/lib/embedding';

// Runs the embedding model inside this server (transformers.js on onnxruntime-node). Loaded only when
// EMBEDDING_PROVIDER=local, so the model and its native library cost nothing otherwise.
//
// The model is fetched from Hugging Face the first time (about 120 MB) and kept in EMBEDDING_CACHE_DIR
// (default ./storage/models). On a server with no internet, put the model files there beforehand and set EMBEDDING_LOCAL_ONLY=1.

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

const g = globalThis as unknown as { __embeddingExtractor?: { key: string; promise: Promise<Extractor> } };

const LOCAL_BATCH = 8;

async function loadExtractor(cfg: Extract<EmbeddingConfig, { kind: 'local' }>): Promise<Extractor> {
  const key = `${cfg.model}|${cfg.cacheDir ?? ''}|${cfg.localOnly}`;
  if (g.__embeddingExtractor?.key === key) return g.__embeddingExtractor.promise;
  const promise = (async () => {
    const tf = await import('@huggingface/transformers');
    tf.env.cacheDir = cfg.cacheDir || path.join(process.cwd(), 'storage', 'models');
    if (cfg.localOnly) tf.env.allowRemoteModels = false;
    // 8-bit weights: a quarter of the size and memory, with almost the same answers
    return (await tf.pipeline('feature-extraction', cfg.model, { dtype: 'q8' })) as unknown as Extractor;
  })();
  g.__embeddingExtractor = { key, promise };
  // a failed load (no network, bad name) must not be remembered: the next try starts again
  promise.catch(() => { if (g.__embeddingExtractor?.promise === promise) g.__embeddingExtractor = undefined; });
  return promise;
}

export async function embedLocal(texts: string[], cfg: Extract<EmbeddingConfig, { kind: 'local' }>): Promise<Float32Array[]> {
  const extractor = await loadExtractor(cfg);
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += LOCAL_BATCH) {
    const rows = (await extractor(texts.slice(i, i + LOCAL_BATCH), { pooling: 'mean', normalize: true })).tolist();
    for (const r of rows) out.push(Float32Array.from(r));
  }
  return out;
}
