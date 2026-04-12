import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { consumeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';
import { setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { challengeId, ...authResponse } = body;

  if (!challengeId) {
    return NextResponse.json({ error: 'missing_challenge_id' }, { status: 400 });
  }

  const expectedChallenge = consumeChallenge(`auth:${challengeId}`);
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'challenge_expired' }, { status: 400 });
  }

  // Find credential by id
  const credentialId = authResponse.id;
  const storedCred = await prisma.passkey_credentials.findUnique({
    where: { credential_id: credentialId },
    include: { user: { select: { id: true, email: true, role: true } } }
  });
  if (!storedCred) {
    return NextResponse.json({ error: 'credential_not_found' }, { status: 401 });
  }

  const { rpID, origin } = getRpConfig();
  const requestOrigin = req.headers.get('origin') || origin;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge,
      expectedOrigin: requestOrigin,
      expectedRPID: rpID,
      credential: {
        id: storedCred.credential_id,
        publicKey: new Uint8Array(storedCred.public_key),
        counter: Number(storedCred.counter),
        transports: storedCred.transports ? JSON.parse(storedCred.transports) : undefined,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'verification_failed' }, { status: 401 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'verification_failed' }, { status: 401 });
  }

  // Update counter and last_used_at
  await prisma.passkey_credentials.update({
    where: { id: storedCred.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      last_used_at: new Date(),
    }
  });

  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, {
    userId: storedCred.user.id,
    email: storedCred.user.email,
    role: storedCred.user.role,
  });
  return res;
}
