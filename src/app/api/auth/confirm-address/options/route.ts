import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getSessionAtNewAddress } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { storeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';
import { checkRateLimit } from '@/lib/rate-limit';

// POST: the challenge for confirming a changed address with the passkey (see ../route.ts). Only the passkeys of the person of this session are offered.
export async function POST(req: NextRequest) {
  const live = await getSessionAtNewAddress();
  if (!live) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sid = live.session.sessionId;
  const limit = checkRateLimit(`confirm-address-options:${sid}`, 20, 5 * 60_000);
  if (!limit.allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });

  const creds = await prisma.passkey_credentials.findMany({ where: { user_id: live.session.userId }, select: { credential_id: true, transports: true } });
  if (creds.length === 0) return NextResponse.json({ error: 'no_passkey' }, { status: 400 });
  const { rpID } = getRpConfig(req.headers.get('origin'));
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map(c => ({ id: c.credential_id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    userVerification: 'required',
  });
  if (!storeChallenge(`confirm:${sid}`, options.challenge)) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  return NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } });
}
