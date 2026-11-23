// Pictures fetched from elsewhere (profile pictures from Mattermost, sender icons from the internet), kept in the database so that a
// restart or a deploy, which empties the in-memory cache, does not send everyone back out to fetch them all again.
// Read order: the in-memory cache ('use cache' in lib/avatar.ts and lib/sender-icon.ts) → this table → the source.
//
// - A picture older than its `fresh` time is fetched again. When that fails (the source is down, too slow), the old picture is shown on
//   and tried again a few minutes later; when the source answers that there is no picture, the old one goes.
// - A row that has not been fetched again for KEEP_DAYS is deleted (pruneImageCache, once a day).
// - Logging out leaves these alone: a picture is kept per owner, not per login, and every logged-in person may see it anyway.
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';

/** What a source answered. */
export type Fetched =
  | { kind: 'found'; data: Buffer; contentType: string; source?: string }
  | { kind: 'none' }    // the source answered: there is no picture
  | { kind: 'failed' }; // the source could not be asked (down, timeout): this says nothing about the picture

/** What the in-memory cache keeps: plain data only (a Buffer cannot be stored there), the picture as base64. */
export type KeptImage = { base64: string; contentType: string; etag: string; source?: string };

/** Seconds until a picture (`found`) or a "no picture" (`none`) is fetched again. */
export type Freshness = { found: number; none: number };

/** The answer, and how many seconds the in-memory cache may keep it. */
export type Answer = { image: KeptImage | null; ttl: number };

export const KEEP_DAYS = 30;
/** A picture larger than this is not kept (nor shown). */
export const MAX_IMAGE_BYTES = 1024 * 1024;
const RETRY_SEC = 300; // a fetch that failed is tried again after five minutes

export const avatarKey = (userId: string) => `avatar:${userId}`;
/** Sender icons are kept under a hash of the address or domain, so the table does not list whom people write with. */
export const senderKey = (kind: 'email' | 'domain', value: string) =>
  `sender:${createHash('sha256').update(`${kind}:${value}`).digest('hex')}`;

export const etagOf = (data: Uint8Array) => `"${createHash('sha256').update(data).digest('base64url').slice(0, 22)}"`;

/** Does the browser's If-None-Match name this ETag (a list, `*` and weak `W/` tags included)? */
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some(t => { const v = t.trim(); return v === '*' || v.replace(/^W\//, '') === etag; });
}

/** Seconds a row fetched at `fetchedAt` stays fresh (0 or less: fetch it again). */
export function secondsLeft(fetchedAt: Date, freshSec: number, now = Date.now()): number {
  return Math.floor(freshSec - (now - fetchedAt.getTime()) / 1000);
}

/** One answer from several lookups tried for the same picture (BIMI, then the favicon, ...): any picture wins; otherwise, a
 *  lookup that could not be made means the answer is unknown, not "no picture". */
export function combine(results: Fetched[]): Fetched {
  return results.find(r => r.kind === 'found') ?? (results.some(r => r.kind === 'failed') ? { kind: 'failed' } : { kind: 'none' });
}

type Row = { data: Uint8Array | null; content_type: string | null; etag: string | null; source: string | null };
function kept(row: Row): KeptImage | null {
  if (!row.data || !row.content_type?.startsWith('image/')) return null;
  const data = Buffer.from(row.data);
  return { base64: data.toString('base64'), contentType: row.content_type, etag: row.etag || etagOf(data), ...(row.source ? { source: row.source } : {}) };
}

/**
 * The picture under `key`: from the table while it is fresh, otherwise from `fetch` (and then kept). `owner` names what the picture
 * was fetched for (the Mattermost user of a profile picture): a row kept for another owner counts as missing, so a picture never
 * outlives a change of who it belongs to, wherever that change was made.
 */
export async function readThrough(opts: {
  key: string;
  userId?: string;
  owner?: string;
  fresh: Freshness;
  fetch: () => Promise<Fetched>;
}): Promise<Answer> {
  const { key, fresh } = opts;
  const owner = opts.owner ?? null;
  const row = await prisma.image_cache.findUnique({ where: { key } }).catch(() => null);
  const mine = row && (row.owner ?? null) === owner ? row : null;
  const old = mine ? kept(mine) : null;
  if (mine) {
    const left = secondsLeft(mine.fetched_at, mine.data ? fresh.found : fresh.none);
    if (left > 0) return { image: old, ttl: left };
  }

  const got = await opts.fetch().catch((): Fetched => ({ kind: 'failed' }));
  if (got.kind === 'failed') return { image: old, ttl: RETRY_SEC };

  const found = got.kind === 'found' && got.data.length > 0 && got.data.length <= MAX_IMAGE_BYTES && got.contentType.startsWith('image/') ? got : null;
  const values = {
    user_id: opts.userId ?? null,
    owner,
    data: found ? found.data : null,
    content_type: found ? found.contentType : null,
    etag: found ? etagOf(found.data) : null,
    source: found?.source ?? null,
    fetched_at: new Date(),
  };
  await prisma.image_cache.upsert({ where: { key }, create: { key, ...values }, update: values })
    .catch(e => console.error('[image-cache] save failed:', e));
  return found ? { image: kept(values), ttl: fresh.found } : { image: null, ttl: fresh.none };
}

/** Throw a kept picture away: the next request fetches it again. */
export async function forgetImage(key: string): Promise<void> {
  await prisma.image_cache.deleteMany({ where: { key } });
}

/** Delete the pictures nobody has needed for KEEP_DAYS (each one in use is fetched again, so kept fresh, long before that). */
export async function pruneImageCache(now = Date.now()): Promise<number> {
  const r = await prisma.image_cache.deleteMany({ where: { fetched_at: { lt: new Date(now - KEEP_DAYS * 24 * 3600 * 1000) } } });
  return r.count;
}
