// Meaning-vectors ("Embedding") for the semantic mail search.
//
// The service is any OpenAI-compatible `POST {EMBEDDING_API_URL}/embeddings` (OpenAI, Voyage, Azure, or a server of your own
// such as Ollama / text-embeddings-inference). It is OFF unless EMBEDDING_API_URL is set: mail text only ever leaves the
// server for the address configured here.

export type EmbeddingConfig = { url: string; key: string | null; model: string; dims: number | null };

export function embeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig | null {
  const url = env.EMBEDDING_API_URL?.trim().replace(/\/+$/, '');
  if (!url) return null;
  const dims = parseInt(env.EMBEDDING_DIMENSIONS || '', 10);
  return {
    url,
    key: env.EMBEDDING_API_KEY?.trim() || null,
    model: env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    dims: Number.isFinite(dims) && dims > 0 ? dims : null,
  };
}

export function embeddingEnabled(): boolean {
  return embeddingConfig() !== null;
}

// The text of a thread that gets embedded: the subject and the newest bodies, cut so a long chain stays cheap.
export const EMBED_MAX_CHARS = 2000;
const PER_MESSAGE_CHARS = 700;

export function buildEmbeddingText(subject: string, bodies: (string | null | undefined)[]): string {
  const parts = [subject.trim()];
  for (const b of bodies) {
    const body = quoteFree(b || '').replace(/\s+/g, ' ').trim();
    if (body) parts.push(body.slice(0, PER_MESSAGE_CHARS));
  }
  return parts.filter(Boolean).join('\n').slice(0, EMBED_MAX_CHARS);
}

// Quoted replies ("> ...") repeat older mail; leaving them in would make every answer look like the first message.
function quoteFree(text: string): string {
  return text.split(/\r?\n/).filter(l => !l.trimStart().startsWith('>')).join('\n');
}

export function normalize(v: number[]): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function packVector(v: Float32Array): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i], i * 4);
  return buf;
}

export function unpackVector(buf: Uint8Array): Float32Array {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float32Array(b.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
  return out;
}

// Both vectors are unit length, so the dot product is the cosine similarity.
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

const REQUEST_TIMEOUT_MS = 15_000;
const BATCH = 16;

/** Embeds the texts (in batches). Throws when the service is off or answers badly: callers decide how to fall back. */
export async function embedTexts(texts: string[], cfg: EmbeddingConfig | null = embeddingConfig()): Promise<Float32Array[]> {
  if (!cfg) throw new Error('embedding_disabled');
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    const res = await fetch(`${cfg.url}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({ model: cfg.model, input, ...(cfg.dims ? { dimensions: cfg.dims } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`embedding_http_${res.status}`);
    const json = await res.json().catch(() => null) as { data?: { index?: number; embedding?: number[] }[] } | null;
    const rows = json?.data;
    if (!Array.isArray(rows) || rows.length !== input.length) throw new Error('embedding_bad_response');
    const sorted = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const r of sorted) {
      if (!Array.isArray(r.embedding) || r.embedding.length === 0) throw new Error('embedding_bad_response');
      out.push(normalize(r.embedding));
    }
  }
  return out;
}
