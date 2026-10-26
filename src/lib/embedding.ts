// Meaning-vectors ("Embedding") for the semantic mail search.
//
// Two ways to make them (the comparison itself, a dot product, always runs in this app):
//  - local  (EMBEDDING_PROVIDER=local): a small multilingual model runs inside this server (src/lib/embedding-local.ts).
//           Mail text never leaves the server.
//  - api    (EMBEDDING_API_URL=...): any OpenAI-compatible `POST {url}/embeddings` (OpenAI, Voyage, Ollama, ...).
// It is OFF unless one of them is set. EMBEDDING_API_URL wins when both are.

export const DEFAULT_LOCAL_MODEL = 'Xenova/multilingual-e5-small';

export type EmbeddingConfig =
  | { kind: 'api'; url: string; key: string | null; model: string; dims: number | null }
  | { kind: 'local'; model: string; dims: null; cacheDir: string | null; localOnly: boolean };

export function embeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig | null {
  const url = env.EMBEDDING_API_URL?.trim().replace(/\/+$/, '');
  if (url) {
    const dims = parseInt(env.EMBEDDING_DIMENSIONS || '', 10);
    return {
      kind: 'api',
      url,
      key: env.EMBEDDING_API_KEY?.trim() || null,
      model: env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
      dims: Number.isFinite(dims) && dims > 0 ? dims : null,
    };
  }
  if (env.EMBEDDING_PROVIDER?.trim().toLowerCase() === 'local') {
    return {
      kind: 'local',
      model: env.EMBEDDING_MODEL?.trim() || DEFAULT_LOCAL_MODEL,
      dims: null,
      cacheDir: env.EMBEDDING_CACHE_DIR?.trim() || null,
      localOnly: env.EMBEDDING_LOCAL_ONLY === '1',
    };
  }
  return null;
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

// E5-style models are trained with these prefixes: what is searched for is a "query", the mail is a "passage".
export type EmbedRole = 'query' | 'passage';
export function withRolePrefix(model: string, role: EmbedRole, text: string): string {
  return /e5/i.test(model) ? `${role}: ${text}` : text;
}

/** Embeds the texts (in batches). Throws when the service is off or answers badly: callers decide how to fall back. */
export async function embedTexts(texts: string[], cfg: EmbeddingConfig | null = embeddingConfig(), role: EmbedRole = 'passage'): Promise<Float32Array[]> {
  if (!cfg) throw new Error('embedding_disabled');
  if (cfg.kind === 'local') {
    const { embedLocal } = await import('@/lib/embedding-local');
    return embedLocal(texts.map(t => withRolePrefix(cfg.model, role, t)), cfg);
  }
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH).map(t => withRolePrefix(cfg.model, role, t));
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
