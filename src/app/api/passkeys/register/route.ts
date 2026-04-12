import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { consumeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const body = await req.json();
  const { name, ...registrationResponse } = body;

  const expectedChallenge = consumeChallenge(`reg:${session.userId}`);
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'challenge_expired' }, { status: 400 });
  }

  const { rpID, origin } = getRpConfig();
  // Use the actual request origin to support any port (dev: 3001, prod: 443, etc.)
  const requestOrigin = req.headers.get('origin') || origin;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge,
      expectedOrigin: requestOrigin,
      expectedRPID: rpID,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'verification_failed' }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;

  await prisma.passkey_credentials.create({
    data: {
      user_id: session.userId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      transports: JSON.stringify(credential.transports ?? []),
      aaguid: aaguid || null,
      name: name || 'パスキー',
    }
  });

  return NextResponse.json({ ok: true });
}
