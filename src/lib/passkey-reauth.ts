// "Prove it again" for somebody who has a passkey: they prove it with the passkey, not the password. Their password does not log them in
// (lib/passkey-policy.ts), so it must not be the thing that unlocks the high-risk actions either; and some of them never knew it.
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { consumeChallenge, storeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';

export const hasPasskey = async (userId: string): Promise<boolean> => (await prisma.passkey_credentials.count({ where: { user_id: userId } })) > 0;

/** The challenge for the person's own passkey (only theirs may answer). Null when the challenge store is full. */
export async function beginPasskeyReauth(userId: string, origin: string | null) {
  const creds = await prisma.passkey_credentials.findMany({ where: { user_id: userId }, select: { credential_id: true, transports: true } });
  const { rpID } = getRpConfig(origin);
  const options = await generateAuthenticationOptions({
    rpID, userVerification: 'required',
    allowCredentials: creds.map(c => ({ id: c.credential_id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
  });
  const challengeId = randomUUID();
  if (!storeChallenge(`reauth:${userId}:${challengeId}`, options.challenge)) return null;
  return { ...options, challengeId };
}

/** True when the answer is a good signature of the challenge made for THIS person, by one of THEIR passkeys. A challenge works once. */
export async function verifyPasskeyReauth(userId: string, answer: unknown, origin: string | null): Promise<boolean> {
  if (!answer || typeof answer !== 'object') return false;
  const { challengeId, ...response } = answer as Record<string, unknown> & { challengeId?: unknown };
  if (typeof challengeId !== 'string' || typeof response.id !== 'string') return false;
  const expectedChallenge = consumeChallenge(`reauth:${userId}:${challengeId}`);
  if (!expectedChallenge) return false;
  const cred = await prisma.passkey_credentials.findFirst({ where: { credential_id: response.id, user_id: userId } });
  if (!cred) return false;
  const { rpID, origin: expectedOrigin } = getRpConfig(origin);
  try {
    const v = await verifyAuthenticationResponse({
      response: response as never, expectedChallenge, expectedOrigin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.credential_id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports ? JSON.parse(cred.transports) : undefined },
    });
    if (!v.verified) return false;
    await prisma.passkey_credentials.update({ where: { id: cred.id }, data: { counter: BigInt(v.authenticationInfo.newCounter), last_used_at: new Date() } });
    return true;
  } catch { return false; }
}
