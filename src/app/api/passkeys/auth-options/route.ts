import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { storeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';
import { randomUUID } from 'crypto';

// POST body: { email? } — if no email, discoverable credential flow
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email: string | undefined = body.email;

  const { rpID } = getRpConfig(req.headers.get('origin'));

  let allowCredentials: { id: string; transports?: any[] }[] | undefined;

  if (email) {
    const user = await prisma.users.findUnique({
      where: { email },
      include: { passkey_credentials: { select: { credential_id: true, transports: true } } }
    });
    if (user && user.passkey_credentials.length > 0) {
      allowCredentials = user.passkey_credentials.map(c => ({
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'required',
  });

  const challengeId = randomUUID();
  storeChallenge(`auth:${challengeId}`, options.challenge);

  return NextResponse.json({ ...options, challengeId });
}
