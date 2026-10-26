// "Keep me logged in" for the installed app (PWA), proved by the device itself.
//
// The app makes a key pair in the browser with WebCrypto; the private half is NOT extractable (not even by the app's own
// scripts: it can only be asked to sign) and lives in IndexedDB. The public half is sent along with the login and kept in
// known_devices, together with its sha256 (key_id): the number that identifies this one installation.
// Later, when the session is gone (idle time, another network address), the app asks for a challenge, signs it and gets a
// new session - no password. Three things must all be right: the "did" cookie of the browser, the signature of the key that
// never leaves the device, and the kind of browser/OS. A stolen cookie or a copied key id alone opens nothing.
import { createHash, randomBytes, webcrypto } from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { deviceFingerprint } from '@/lib/device';
import { DEVICE_COOKIE } from '@/lib/known-device';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { sealShort, unsealShort } from '@/lib/short-token';

/** The app attaches its public key (SPKI, base64url) to login requests with this header. */
export const KEY_HEADER = 'x-device-key';
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const subtle = webcrypto.subtle;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

/** What the device signs. Binds the answer to this device (key_id) and to this one challenge. */
export const resumeMessage = (keyId: string, challenge: string) => `webmail-resume|v1|${keyId}|${challenge}`;

/** A public key sent by the app: a P-256 ECDSA key in SPKI form (91 bytes), or null. */
export async function parseDevicePublicKey(value: string | null | undefined): Promise<{ spki: string; keyId: string } | null> {
  if (!value || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = fromB64url(value);
    if (bytes.length !== 91) return null;
    await subtle.importKey('spki', bytes, ECDSA, true, ['verify']);
    return { spki: value, keyId: sha256(bytes) };
  } catch {
    return null;
  }
}

/** Is `signature` (IEEE-P1363, base64url, as WebCrypto makes it) a signature of `message` by the key? */
export async function verifyDeviceSignature(spki: string, message: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== 'string' || signature.length > 200 || !/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  try {
    const key = await subtle.importKey('spki', fromB64url(spki), ECDSA, false, ['verify']);
    const sig = fromB64url(signature);
    return sig.length === 64 && (await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, new TextEncoder().encode(message)));
  } catch {
    return false;
  }
}

// A challenge is good for one answer: remembered here until it would have expired anyway.
const g = globalThis as unknown as { __usedResumeChallenges?: Map<string, number> };
const used = (g.__usedResumeChallenges ??= new Map<string, number>());

export const issueChallenge = (ip: string) => sealShort('device-resume', { n: randomBytes(16).toString('hex'), ip }, CHALLENGE_TTL_MS);

/** True once for a genuine, unexpired challenge that was asked for from this same address. */
export async function consumeChallenge(token: unknown, ip: string): Promise<boolean> {
  const note = await unsealShort<{ n: string; ip: string }>('device-resume', token);
  if (!note || note.ip !== ip) return false;
  const now = Date.now();
  for (const [n, at] of used) if (now - at > CHALLENGE_TTL_MS * 2) used.delete(n);
  if (used.has(note.n)) return false;
  used.set(note.n, now);
  return true;
}

/** After a login: if the app sent its key and the policy allows it, this browser may log in again without a password. */
export async function enableRemember(deviceId: string, header: string | null, userAgent: string): Promise<{ days: number; keyId: string } | null> {
  const { rememberDays } = await loadSecurityPolicy();
  if (rememberDays <= 0) return null;
  const key = await parseDevicePublicKey(header);
  if (!key) return null;
  await prisma.known_devices.update({
    where: { id: deviceId },
    data: { public_key: key.spki, key_id: key.keyId, device_fp: deviceFingerprint(userAgent), remember_until: new Date(Date.now() + rememberDays * 86400_000) },
  });
  return { days: rememberDays, keyId: key.keyId };
}

/** This browser has to log in with a password again (logout, password change, 2FA change, "log out everywhere"). */
export async function forgetRemembered(where: { userId?: string; token?: string }) {
  const tokenHash = where.token ? sha256(where.token) : undefined;
  if (!where.userId && !tokenHash) return;
  await prisma.known_devices.updateMany({
    where: { ...(where.userId ? { user_id: where.userId } : {}), ...(tokenHash ? { token_hash: tokenHash } : {}), remember_until: { not: null } },
    data: { remember_until: null, public_key: null },
  });
}

export type ResumeFailure = 'policy_off' | 'no_device' | 'locked' | 'bad_challenge' | 'fingerprint' | 'signature';

/** Everything that must hold for a login without a password. Country and address rules are checked by the caller. */
export async function checkResume(req: NextRequest, ip: string, body: { challenge?: unknown; signature?: unknown }) {
  if ((await loadSecurityPolicy()).rememberDays <= 0) return { ok: false as const, reason: 'policy_off' as const };
  const token = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 100) return { ok: false as const, reason: 'no_device' as const };
  const device = await prisma.known_devices.findFirst({
    where: { token_hash: sha256(token), remember_until: { gt: new Date() }, public_key: { not: null }, key_id: { not: null } },
    include: { user: { select: { id: true, email: true, role: true, locked_at: true } } },
  });
  if (!device?.public_key || !device.key_id) return { ok: false as const, reason: 'no_device' as const };
  if (device.user.locked_at) return { ok: false as const, reason: 'locked' as const, device };
  if (!(await consumeChallenge(body.challenge, ip))) return { ok: false as const, reason: 'bad_challenge' as const, device };
  if (deviceFingerprint(req.headers.get('user-agent')) !== device.device_fp) return { ok: false as const, reason: 'fingerprint' as const, device };
  if (!(await verifyDeviceSignature(device.public_key, resumeMessage(device.key_id, body.challenge as string), body.signature))) return { ok: false as const, reason: 'signature' as const, device };
  return { ok: true as const, device, user: device.user };
}
