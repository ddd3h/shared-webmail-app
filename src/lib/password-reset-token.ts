import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/db';

// One-time password-reset links. Only the SHA-256 of the token is stored; /api/profile/password-reset looks it up by that hash.

export const hashResetToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export const resetUrl = (rawToken: string): string =>
  `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}/reset-password?token=${rawToken}`;

/** Makes a new token for the person (any earlier unused one stops working) and returns the raw token to hand over. */
export async function issueResetToken(userId: string, ttlMs: number): Promise<string> {
  await prisma.password_reset_tokens.deleteMany({ where: { OR: [{ used: true }, { expires_at: { lt: new Date() } }] } });
  await prisma.password_reset_tokens.updateMany({ where: { user_id: userId, used: false }, data: { used: true } });
  const raw = randomBytes(32).toString('base64url');
  await prisma.password_reset_tokens.create({ data: { user_id: userId, token_hash: hashResetToken(raw), expires_at: new Date(Date.now() + ttlMs) } });
  return raw;
}
