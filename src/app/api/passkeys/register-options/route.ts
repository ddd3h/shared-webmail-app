import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { storeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';
import { canRegisterPasskey } from '@/lib/passkey-policy';

export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const { rpName, rpID } = getRpConfig(req.headers.get('origin'));

  const existing = await prisma.passkey_credentials.findMany({
    where: { user_id: session.userId },
    select: { credential_id: true, transports: true }
  });
  if (!canRegisterPasskey(existing.length)) {
    return NextResponse.json({ error: 'passkey_limit', message: 'パスキーは1人1つまでです。今のパスキーを削除してから登録してください' }, { status: 409 });
  }

  const user = await prisma.users.findUnique({
    where: { id: session.userId },
    select: { email: true, name: true }
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user?.email ?? session.email,
    userDisplayName: user?.name ?? session.email,
    userID: new TextEncoder().encode(session.userId),
    excludeCredentials: existing.map(c => ({
      id: c.credential_id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  storeChallenge(`reg:${session.userId}`, options.challenge);

  return NextResponse.json(options);
}
