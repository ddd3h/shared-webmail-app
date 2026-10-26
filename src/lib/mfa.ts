// Second factor (authenticator app + recovery codes): everything that touches the database or checks a code.
import { createHmac } from 'crypto';
import QRCode from 'qrcode';
import { sessionPassword } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { RECOVERY_CODE_COUNT, generateRecoveryCode, generateSecret, looksLikeRecoveryCode, normalizeRecoveryCode, otpauthUri, verifyCode } from '@/lib/totp';

export const ISSUER = '共有メールワークスペース';
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;       // wrong codes per person per window
const MAX_TRIES_PER_IP = 20;

export const hasTotp = (u: { totp_secret_enc: string | null; totp_enabled_at: Date | null }) => !!u.totp_secret_enc && !!u.totp_enabled_at;

// Recovery codes are kept as keyed hashes: a copy of the table alone is not enough to use or even test them.
const hashRecovery = (code: string) => createHmac('sha256', sessionPassword().secret).update(normalizeRecoveryCode(code)).digest('hex');

/** May this person / address try a code now? Counts the try; call `forgiveTries` after a success. */
export function gateSecondFactor(userId: string, ip: string): { ok: true } | { ok: false; retryAfterSec: number; firstBlock: boolean } {
  const person = checkRateLimit(`mfa:user:${userId}`, MAX_TRIES, WINDOW_MS);
  if (!person.allowed) return { ok: false, retryAfterSec: person.retryAfterSec, firstBlock: person.isFirstBlock };
  const address = checkRateLimit(`mfa:ip:${ip}`, MAX_TRIES_PER_IP, WINDOW_MS);
  if (!address.allowed) return { ok: false, retryAfterSec: address.retryAfterSec, firstBlock: address.isFirstBlock };
  return { ok: true };
}
export const forgiveTries = (userId: string) => resetRateLimit(`mfa:user:${userId}`);

/** A recovery code is spent at the moment it is accepted (the conditional update makes two simultaneous uses impossible). */
async function spendRecoveryCode(userId: string, input: string): Promise<boolean> {
  const row = await prisma.recovery_codes.findFirst({ where: { user_id: userId, code_hash: hashRecovery(input), used_at: null }, select: { id: true } });
  if (!row) return false;
  return (await prisma.recovery_codes.updateMany({ where: { id: row.id, used_at: null }, data: { used_at: new Date() } })).count === 1;
}

async function acceptTotp(user: { id: string; totp_secret_enc: string | null; totp_last_step: number | null }, input: string): Promise<boolean> {
  if (!user.totp_secret_enc) return false;
  const secret = await decrypt(user.totp_secret_enc).catch(() => null);
  const step = secret ? verifyCode(secret, input, { lastStep: user.totp_last_step }) : null;
  if (step === null) return false;
  // remember the step only if nobody got there first: a code works once, even when two requests race
  const r = await prisma.users.updateMany({ where: { id: user.id, OR: [{ totp_last_step: null }, { totp_last_step: { lt: step } }] }, data: { totp_last_step: step } });
  return r.count === 1;
}

export type SecondFactor = { ok: true; method: 'totp' | 'recovery' } | { ok: false };

export async function checkSecondFactor(userId: string, input: unknown): Promise<SecondFactor> {
  if (typeof input !== 'string' || input.length > 64) return { ok: false };
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, totp_secret_enc: true, totp_enabled_at: true, totp_last_step: true } });
  if (!user || !hasTotp(user)) return { ok: false };
  if (looksLikeRecoveryCode(input)) return (await spendRecoveryCode(userId, input)) ? { ok: true, method: 'recovery' } : { ok: false };
  return (await acceptTotp(user, input)) ? { ok: true, method: 'totp' } : { ok: false };
}

// ---- turning it on ----
export async function beginEnrollment(account: string): Promise<{ secret: string; uri: string; qr: string }> {
  const secret = generateSecret();
  const uri = otpauthUri({ secret, account, issuer: ISSUER });
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/** New set of recovery codes (the old ones stop working). Returns them in clear text — the only time they can be seen. */
export async function createRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await prisma.$transaction([
    prisma.recovery_codes.deleteMany({ where: { user_id: userId } }),
    prisma.recovery_codes.createMany({ data: codes.map(c => ({ user_id: userId, code_hash: hashRecovery(c) })) }),
  ]);
  return codes;
}

/** Saves the secret once the person has proved their app shows the right codes. Returns the recovery codes, or null for a wrong code. */
export async function enableTotp(userId: string, secret: string, code: unknown): Promise<string[] | null> {
  const step = typeof code === 'string' ? verifyCode(secret, code) : null;
  if (step === null) return null;
  await prisma.users.update({ where: { id: userId }, data: { totp_secret_enc: await encrypt(secret), totp_enabled_at: new Date(), totp_last_step: step } });
  return createRecoveryCodes(userId);
}

/** Back to "no second factor": secret, recovery codes and every "trusted browser" are gone. */
export async function clearTotp(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.users.update({ where: { id: userId }, data: { totp_secret_enc: null, totp_enabled_at: null, totp_last_step: null } }),
    prisma.recovery_codes.deleteMany({ where: { user_id: userId } }),
    prisma.known_devices.updateMany({ where: { user_id: userId }, data: { mfa_trusted_until: null } }),
  ]);
}

export async function mfaStatus(userId: string) {
  const [user, remaining, passkeys] = await Promise.all([
    prisma.users.findUnique({ where: { id: userId }, select: { totp_secret_enc: true, totp_enabled_at: true } }),
    prisma.recovery_codes.count({ where: { user_id: userId, used_at: null } }),
    prisma.passkey_credentials.count({ where: { user_id: userId } }),
  ]);
  return { enabled: !!user && hasTotp(user), enabled_at: user?.totp_enabled_at ?? null, recovery_remaining: remaining, passkeys };
}
