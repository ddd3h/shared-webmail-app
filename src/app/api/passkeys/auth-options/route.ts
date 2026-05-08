import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { storeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendDosAlert } from '@/lib/dos-alert';
import { randomUUID } from 'crypto';

// 20 challenge requests per 5 minutes per IP
const WINDOW_MS = 5 * 60 * 1000;
const IP_LIMIT = 20;

// POST body: { email? } — if no email, discoverable credential flow
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const result = checkRateLimit(`passkey-options:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!result.allowed) {
    if (result.isFirstBlock) sendDosAlert(ip, 'passkey-options', result.retryAfterSec);
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
    );
  }

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
  const stored = storeChallenge(`auth:${challengeId}`, options.challenge);
  if (!stored) {
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  return NextResponse.json({ ...options, challengeId });
}
