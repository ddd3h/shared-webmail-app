import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  buildEmbeddingText, embeddingConfig, embedTexts, packVector, similarity, unpackVector,
  type EmbeddingConfig,
} from '@/lib/embedding';

// How many messages of a thread go into its vector (newest first).
const MESSAGES_PER_THREAD = 3;
// Below this cosine similarity a thread is not "close in meaning" (the right value depends on the model: raise it for a noisier one).
export const DEFAULT_MIN_SIMILARITY = 0.3;
export const SEMANTIC_LIMIT = 20;

export function minSimilarity(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseFloat(env.EMBEDDING_MIN_SCORE || '');
  return Number.isFinite(n) && n > -1 && n < 1 ? n : DEFAULT_MIN_SIMILARITY;
}

/** Ranks candidates by similarity to the query, best first, dropping the ones that are not close enough. */
export function rankBySimilarity<T extends { vector: Float32Array }>(query: Float32Array, candidates: (T & { id: string })[], min: number, limit: number) {
  return candidates
    .map(c => ({ id: c.id, score: similarity(query, c.vector) }))
    .filter(r => r.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Embeds up to `limit` threads that have no vector yet or whose mail changed since (newest mail first).
 * Called by the background timer and /api/cron/embeddings; a failing service just leaves the threads for the next round.
 */
export async function indexPendingThreads(limit = 20, cfg: EmbeddingConfig | null = embeddingConfig()): Promise<{ indexed: number; pending: number }> {
  if (!cfg) return { indexed: 0, pending: 0 };
  const dims = cfg.dims;
  const stale = Prisma.sql`
    t.is_spam = false AND (
      e.thread_id IS NULL
      OR e.model <> ${cfg.model}
      ${dims ? Prisma.sql`OR e.dims <> ${dims}` : Prisma.empty}
      OR e.embedded_at < LEAST(t.last_message_at, now())
    )`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM threads t LEFT JOIN thread_embeddings e ON e.thread_id = t.id
    WHERE ${stale} ORDER BY t.last_message_at DESC LIMIT ${limit}`;
  if (rows.length === 0) return { indexed: 0, pending: 0 };

  const threads = await prisma.threads.findMany({
    where: { id: { in: rows.map(r => r.id) } },
    select: {
      id: true, subject: true,
      messages: { orderBy: { sent_at: 'desc' }, take: MESSAGES_PER_THREAD, select: { text_body: true } },
    },
  });
  const texts = threads.map(t => buildEmbeddingText(t.subject, t.messages.map(m => m.text_body)));
  const vectors = await embedTexts(texts, cfg);
  for (let i = 0; i < threads.length; i++) {
    const data = { model: cfg.model, dims: vectors[i].length, vector: packVector(vectors[i]), embedded_at: new Date() };
    await prisma.thread_embeddings.upsert({ where: { thread_id: threads[i].id }, create: { thread_id: threads[i].id, ...data }, update: data });
  }
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM threads t LEFT JOIN thread_embeddings e ON e.thread_id = t.id WHERE ${stale}`;
  return { indexed: threads.length, pending: Number(n) };
}

/** Indexes everything that is pending, a batch at a time (for the first run after turning the feature on). */
export async function indexAllPending(maxRounds = 50) {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    const r = await indexPendingThreads();
    total += r.indexed;
    if (r.indexed === 0 || r.pending === 0) return { indexed: total, pending: r.pending };
  }
  return { indexed: total, pending: -1 };
}

// The same words are asked again by the personal and the team list, and again on the next page: embed them once.
const queryCache = new Map<string, Float32Array>();
const QUERY_CACHE_MAX = 100;

async function embedQuery(text: string, cfg: EmbeddingConfig): Promise<Float32Array> {
  const key = `${cfg.model}|${cfg.dims ?? ''}|${text}`;
  const hit = queryCache.get(key);
  if (hit) return hit;
  const [v] = await embedTexts([text], cfg, 'query');
  if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string);
  queryCache.set(key, v);
  return v;
}

/**
 * The threads (among those `where` allows) whose meaning is closest to `text`, best first.
 * Returns null when the service is off or fails, so the caller falls back to the plain keyword search.
 */
export async function findSimilarThreads(where: Prisma.threadsWhereInput, text: string, limit = SEMANTIC_LIMIT): Promise<{ id: string; score: number }[] | null> {
  const cfg = embeddingConfig();
  if (!cfg || !text.trim()) return null;
  try {
    const query = await embedQuery(text.trim(), cfg);
    const rows = await prisma.threads.findMany({
      where: { AND: [where, { embedding: { is: { model: cfg.model } } }] },
      select: { id: true, embedding: { select: { vector: true } } },
    });
    const candidates = rows.flatMap(r => (r.embedding ? [{ id: r.id, vector: unpackVector(r.embedding.vector) }] : []));
    return rankBySimilarity(query, candidates, minSimilarity(), limit);
  } catch (e) {
    console.error('[semantic] search failed:', (e as Error)?.message || e);
    return null;
  }
}

export async function embeddingStatus() {
  const cfg = embeddingConfig();
  if (!cfg) return { enabled: false as const };
  const [indexed, total] = await Promise.all([
    prisma.thread_embeddings.count({ where: { model: cfg.model } }),
    prisma.threads.count({ where: { is_spam: false } }),
  ]);
  return { enabled: true as const, model: cfg.model, indexed, total };
}
