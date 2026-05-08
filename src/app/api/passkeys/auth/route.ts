import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { consumeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';
import { setSessionCookie } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendDosAlert } from '@/lib/dos-alert';
import { logAudit } from '@/lib/audit';

// 10 verification attempts per 5 minutes per IP
const WINDOW_MS = 5 * 60 * 1000;
const IP_LIMIT = 10;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const result = checkRateLimit(`passkey-auth:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!result.allowed) {
    if (result.isFirstBlock) sendDosAlert(ip, 'passkey-auth', result.retryAfterSec);
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
    );
  }

  const body = await req.json();
  const { challengeId, ...authResponse } = body;

  if (!challengeId) {
    return NextResponse.json({ error: 'missing_challenge_id' }, { status: 400 });
  }

  const expectedChallenge = consumeChallenge(`auth:${challengeId}`);
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'challenge_expired' }, { status: 400 });
  }

  const credentialId = authResponse.id;
  const storedCred = await prisma.passkey_credentials.findUnique({
    where: { credential_id: credentialId },
    include: { user: { select: { id: true, email: true, role: true } } }
  });
  if (!storedCred) {
    await logAudit({
      actionType: 'passkey_auth_failed',
      targetType: 'passkey_credentials',
      metadata: { ip, reason: 'credential_not_found' },
    });
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
    await logAudit({
      actionType: 'passkey_auth_failed',
      targetType: 'passkey_credentials',
      targetId: storedCred.id,
      metadata: { ip, reason: e?.message || 'verification_error' },
    });
    return NextResponse.json({ error: e?.message || 'verification_failed' }, { status: 401 });
  }

  if (!verification.verified) {
    await logAudit({
      actionType: 'passkey_auth_failed',
      targetType: 'passkey_credentials',
      targetId: storedCred.id,
      metadata: { ip, reason: 'not_verified' },
    });
    return NextResponse.json({ error: 'verification_failed' }, { status: 401 });
  }

  await prisma.passkey_credentials.update({
    where: { id: storedCred.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      last_used_at: new Date(),
    }
  });

  await logAudit({
    actorUserId: storedCred.user.id,
    actionType: 'passkey_auth_success',
    targetType: 'passkey_credentials',
    targetId: storedCred.id,
    metadata: { ip },
  });

  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, {
    userId: storedCred.user.id,
    email: storedCred.user.email,
    role: storedCred.user.role,
  });
  return res;
}
