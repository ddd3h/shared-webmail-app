// Profile pictures come from Mattermost. The cache (not a file of ours) keeps each picture for a day;
// forgetAvatar() drops one on purpose (the person logged out, or was linked to another Mattermost account).
import { cacheLife, cacheTag, revalidateTag } from 'next/cache';
import { prisma } from '@/lib/db';

// What the cache keeps: plain data only (a Buffer cannot be stored), the image as base64.
export type StoredAvatar = { base64: string; contentType: string };

const tagOf = (userId: string) => `avatar:${userId}`;
// Seconds. A picture is reused for a day; "no picture / Mattermost unreachable" is tried again after five minutes.
const FOUND = { stale: 300, revalidate: 24 * 3600, expire: 7 * 24 * 3600 };
const MISSING = { stale: 60, revalidate: 300, expire: 3600 };

async function fetchFromMattermost(userId: string): Promise<StoredAvatar | null> {
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { mattermost_user_id: true } });
  if (!user?.mattermost_user_id) return null;

  const settings = await prisma.app_settings.findMany({ where: { key: { in: ['MATTERMOST_BASE_URL', 'MATTERMOST_BOT_TOKEN'] } } });
  const setting = (key: string) => settings.find(s => s.key === key)?.value || '';
  const baseUrl = (setting('MATTERMOST_BASE_URL') || process.env.MATTERMOST_BASE_URL || '').replace(/\/+$/, '');
  const botToken = setting('MATTERMOST_BOT_TOKEN') || process.env.MATTERMOST_BOT_TOKEN;
  if (!baseUrl || !botToken) return null;

  try {
    const res = await fetch(`${baseUrl}/api/v4/users/${user.mattermost_user_id}/image`, {
      headers: { Authorization: `Bearer ${botToken}`, 'User-Agent': 'WebMailApp/1.0' },
    });
    if (!res.ok) return null;
    return { base64: Buffer.from(await res.arrayBuffer()).toString('base64'), contentType: res.headers.get('content-type') || 'image/png' };
  } catch {
    return null;
  }
}

export async function loadAvatar(userId: string): Promise<StoredAvatar | null> {
  'use cache';
  cacheTag(tagOf(userId));
  const avatar = await fetchFromMattermost(userId);
  cacheLife(avatar ? FOUND : MISSING);
  return avatar;
}

/** Throw the saved picture away: the next request fetches it again. */
export function forgetAvatar(userId: string) {
  revalidateTag(tagOf(userId), { expire: 0 });
}
