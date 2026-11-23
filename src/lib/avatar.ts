// Profile pictures come from Mattermost. Each is kept in memory ('use cache') and in the database (lib/image-store.ts), so a
// restart or a deploy does not fetch them all again; a picture is fetched again after a day. Logging out leaves it alone (it is
// kept per person, and every logged-in person may see it). forgetAvatar() drops one on purpose (linked to another Mattermost account).
import { cacheLife, cacheTag, revalidateTag } from 'next/cache';
import { prisma } from '@/lib/db';
import { avatarKey, forgetImage, readThrough, type Fetched, type KeptImage } from '@/lib/image-store';

export type StoredAvatar = KeptImage;

const tagOf = (userId: string) => `avatar:${userId}`;
// Seconds. A picture is fetched again after a day; "no picture" after five minutes. The memory keeps an entry up to a week
// (serving it while a fresh one is fetched in the background).
const FOUND = { stale: 300, revalidate: 24 * 3600, expire: 7 * 24 * 3600 };
const MISSING = { stale: 60, revalidate: 300, expire: 3600 };

async function fetchFromMattermost(mattermostUserId: string): Promise<Fetched> {
  const settings = await prisma.app_settings.findMany({ where: { key: { in: ['MATTERMOST_BASE_URL', 'MATTERMOST_BOT_TOKEN'] } } });
  const setting = (key: string) => settings.find(s => s.key === key)?.value || '';
  const baseUrl = (setting('MATTERMOST_BASE_URL') || process.env.MATTERMOST_BASE_URL || '').replace(/\/+$/, '');
  const botToken = setting('MATTERMOST_BOT_TOKEN') || process.env.MATTERMOST_BOT_TOKEN;
  if (!baseUrl || !botToken) return { kind: 'none' }; // no Mattermost connected: no pictures

  try {
    const res = await fetch(`${baseUrl}/api/v4/users/${encodeURIComponent(mattermostUserId)}/image`, {
      headers: { Authorization: `Bearer ${botToken}`, 'User-Agent': 'WebMailApp/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { kind: 'none' };
    if (!res.ok) return { kind: 'failed' }; // down, or our token is refused: keep showing what we had
    const contentType = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    return { kind: 'found', data: Buffer.from(await res.arrayBuffer()), contentType };
  } catch {
    return { kind: 'failed' };
  }
}

/** The picture of `userId`, who is linked to the Mattermost user `mattermostUserId` (part of the key: a new link is a new picture). */
export async function loadAvatar(userId: string, mattermostUserId: string): Promise<StoredAvatar | null> {
  'use cache';
  cacheTag(tagOf(userId));
  const { image, ttl } = await readThrough({
    key: avatarKey(userId),
    userId,
    owner: mattermostUserId,
    fresh: { found: FOUND.revalidate, none: MISSING.revalidate },
    fetch: () => fetchFromMattermost(mattermostUserId),
  });
  const base = image ? FOUND : MISSING;
  const revalidate = Math.max(60, Math.min(base.revalidate, ttl));
  cacheLife({ stale: Math.min(base.stale, revalidate), revalidate, expire: base.expire });
  return image;
}

/** Throw the kept picture away (the database row first, so the memory cannot be filled again from it): the next request fetches it again. */
export async function forgetAvatar(userId: string): Promise<void> {
  await forgetImage(avatarKey(userId)).catch(e => console.error('[avatar] forget failed:', e));
  revalidateTag(tagOf(userId), { expire: 0 });
}
