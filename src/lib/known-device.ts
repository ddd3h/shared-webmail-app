// "Is this a browser we have seen this person use?" A random token lives in a cookie; only its hash is stored.
import { createHash, randomBytes } from 'crypto';
import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const DEVICE_COOKIE = 'did';
const ONE_YEAR_S = 365 * 24 * 3600;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export type DeviceContext = { ip: string; userAgent: string; country?: string | null; city?: string | null };

/** The stored device matching the cookie, if it belongs to this user. */
export async function findKnownDevice(token: string | undefined, userId: string) {
  if (!token || token.length < 20 || token.length > 100) return null;
  return prisma.known_devices.findFirst({ where: { token_hash: sha(token), user_id: userId } });
}

/** Lets the login throttle know the caller already holds a device cookie, before anybody has proved who they are. */
export async function isKnownDeviceFor(email: string, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 20 || token.length > 100) return false;
  const d = await prisma.known_devices.findFirst({ where: { token_hash: sha(token), user: { email } }, select: { id: true } });
  return !!d;
}

/** Marks this browser as known (creating the cookie on first use). Returns whether it was new and how many the person had. */
export async function rememberDevice(res: NextResponse, userId: string, token: string | undefined, ctx: DeviceContext, trustMfaUntil?: Date): Promise<{ isNew: boolean; hadAny: boolean; deviceId: string }> {
  const existing = await findKnownDevice(token, userId);
  if (existing) {
    await prisma.known_devices.update({ where: { id: existing.id }, data: { last_seen_at: new Date(), last_ip: ctx.ip, country: ctx.country ?? existing.country, city: ctx.city ?? existing.city, ...(trustMfaUntil ? { mfa_trusted_until: trustMfaUntil } : {}) } });
    return { isNew: false, hadAny: true, deviceId: existing.id };
  }
  const hadAny = (await prisma.known_devices.count({ where: { user_id: userId } })) > 0;
  const fresh = randomBytes(32).toString('base64url');
  const row = await prisma.known_devices.create({
    data: { user_id: userId, token_hash: sha(fresh), user_agent: ctx.userAgent || null, first_ip: ctx.ip, last_ip: ctx.ip, country: ctx.country ?? null, city: ctx.city ?? null, mfa_trusted_until: trustMfaUntil ?? null },
  });
  res.cookies.set(DEVICE_COOKIE, fresh, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: ONE_YEAR_S });
  return { isNew: true, hadAny, deviceId: row.id };
}

/** Did this person tick "trust this browser" here recently enough? Then the second step is skipped. */
export async function isTrustedForMfa(token: string | undefined, userId: string): Promise<boolean> {
  const d = await findKnownDevice(token, userId);
  return !!d?.mfa_trusted_until && d.mfa_trusted_until > new Date();
}
