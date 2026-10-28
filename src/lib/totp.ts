// Time-based one-time passwords (RFC 6238) as used by authenticator apps: 6 digits, 30 seconds, HMAC-SHA1. Pure functions.
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer | null {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, the size apps expect), as base32 text. */
export const generateSecret = () => base32Encode(randomBytes(20));

export const stepAt = (epochMs: number) => Math.floor(epochMs / 1000 / STEP_SECONDS);

/** The code for one 30-second step. */
export function codeForStep(secret: Buffer, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(counter).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const sameCode = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks what the person typed. A clock that is a little off is tolerated (one step either way), and a step that was
 * already accepted (`lastStep`) is refused, so a code that was seen over somebody's shoulder can't be used again.
 * Returns the accepted step, or null.
 */
export function verifyCode(secretBase32: string, input: string, o: { now?: number; lastStep?: number | null; window?: number } = {}): number | null {
  const secret = base32Decode(secretBase32);
  const code = input.replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(code)) return null;
  const current = stepAt(o.now ?? Date.now());
  const window = o.window ?? 1;
  let accepted: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    // every step is compared (no early exit) so the time taken doesn't reveal which one matched
    if (sameCode(codeForStep(secret, step), code) && (o.lastStep == null || step > o.lastStep)) accepted = step;
  }
  return accepted;
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUri(o: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${o.issuer}:${o.account}`);
  return `otpauth://totp/${label}?secret=${o.secret}&issuer=${encodeURIComponent(o.issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---- recovery codes ----
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (l, i, o, 0, 1)
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map(b => CODE_CHARS[b % CODE_CHARS.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

/** What a person typed → the form that was stored (case, spaces and the dash don't matter). */
export const normalizeRecoveryCode = (input: string) => input.toLowerCase().replace(/[^a-z0-9]/g, '');
export const looksLikeRecoveryCode = (input: string) => normalizeRecoveryCode(input).length === 10;
