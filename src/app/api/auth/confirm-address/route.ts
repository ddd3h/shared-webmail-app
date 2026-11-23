import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getSessionAtNewAddress, revokeSuspicious } from '@/lib/auth';
import { PENDING_COOKIE, clearPendingAddresses, needsCode, newAddresses, pendingAddresses, proofMethod, withConfirmed } from '@/lib/address-confirm';
import { clientIpFrom } from '@/lib/client-ip';
import { prisma } from '@/lib/db';
import { lookupIp } from '@/lib/ip-lookup';
import { countryAllowed } from '@/lib/login-flow';
import { checkSecondFactor } from '@/lib/mfa';
import { consumeChallenge } from '@/lib/passkey-challenge';
import { getRpConfig } from '@/lib/passkey-rp';
import { verifyPassword } from '@/lib/password';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { recordSecurityEvent } from '@/lib/security-events';

// The address of this session changed (see lib/address-confirm.ts): the person proves who they are again, the way they log in, and the session
// goes on from the new address. GET says whether that is needed here and how; POST gives the proof. Wrong proofs are limited per session:
// the fifth ends the session (a stolen cookie guessing the password gets five tries, then nothing).
const MAX_WRONG = 5;
const WINDOW_MS = 15 * 60_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

async function load(req: NextRequest) {
  const live = await getSessionAtNewAddress();
  if (!live) return null;
  const { session } = live;
  const row = await prisma.sessions.findUnique({
    where: { id: session.sessionId },
    select: {
      ip_address: true, confirmed_ips: true,
      user: { select: { id: true, password_hash: true, totp_secret_enc: true, totp_enabled_at: true, passkey_credentials: { select: { id: true, credential_id: true, public_key: true, counter: true, transports: true } } } },
    },
  });
  if (!row) return null;
  const ip = clientIpFrom(name => req.headers.get(name));
  const pending = await pendingAddresses(req.cookies.get(PENDING_COOKIE)?.value, session.sessionId);
  const toApprove = newAddresses([ip, ...pending], [row.ip_address, ...row.confirmed_ips]);
  return { session, row, user: row.user, ip, toApprove, method: proofMethod(row.user, row.user.passkey_credentials.length) };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof load>>>;

function unauthorized() {
  const res = NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  res.cookies.delete('sid');
  clearPendingAddresses(res);
  return res;
}
async function end(c: Ctx, reason: string) {
  await revokeSuspicious(c.session.sessionId, c.session.userId, 'session_ip_mismatch', { expected: c.row.ip_address, got: c.toApprove, reason });
  return unauthorized();
}

export async function GET(req: NextRequest) {
  const c = await load(req);
  if (!c) return unauthorized();
  if (c.toApprove.length > 0 && c.method === 'none') return end(c, 'no_proof_method'); // nothing to prove it with: the session ends, as it did before
  return NextResponse.json({ needed: c.toApprove.length > 0, method: c.method, code: c.method === 'password' && needsCode(c.user) }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const c = await load(req);
  if (!c) return unauthorized();
  if (c.toApprove.length === 0) { const res = NextResponse.json({ ok: true }, { headers: NO_STORE }); clearPendingAddresses(res); return res; }
  if (c.method === 'none') return end(c, 'no_proof_method');

  const sid = c.session.sessionId;
  const triesKey = `confirm-address:${sid}`;
  const wrong = async (error: string) => {
    await recordSecurityEvent({ type: 'session_ip_confirm_failed', severity: 'warn', ip: c.ip, userId: c.session.userId, detail: { error, expected: c.row.ip_address, got: c.toApprove } });
    if (!checkRateLimit(triesKey, MAX_WRONG - 1, WINDOW_MS).allowed) return end(c, 'too_many_wrong_proofs');
    return NextResponse.json({ error }, { status: 400, headers: NO_STORE });
  };

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (c.method === 'passkey') {
    const answer = body.passkey as { id?: unknown } | undefined;
    const expectedChallenge = consumeChallenge(`confirm:${sid}`);
    if (!expectedChallenge) return NextResponse.json({ error: 'challenge_expired' }, { status: 400, headers: NO_STORE }); // (not a wrong proof: it just took too long)
    const cred = typeof answer?.id === 'string' ? c.user.passkey_credentials.find(k => k.credential_id === answer.id) : undefined;
    if (!cred) return wrong('passkey_failed'); // only a passkey of this very person counts
    const { rpID, origin } = getRpConfig(req.headers.get('origin'));
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response: answer as any, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID,
        credential: { id: cred.credential_id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports ? JSON.parse(cred.transports) : undefined },
      });
    } catch { return wrong('passkey_failed'); }
    if (!verification.verified) return wrong('passkey_failed');
    await prisma.passkey_credentials.update({ where: { id: cred.id }, data: { counter: BigInt(verification.authenticationInfo.newCounter), last_used_at: new Date() } });
  } else {
    const password = body.password;
    if (typeof password !== 'string' || !password || password.length > 1000 || !(await verifyPassword(password, c.user.password_hash!))) return wrong('wrong_password');
    if (needsCode(c.user) && !(await checkSecondFactor(c.user.id, body.code)).ok) return wrong('invalid_code');
  }
  resetRateLimit(triesKey);

  // the countries the login is limited to hold for every address the session is used from
  for (const ip of c.toApprove) if (!(await countryAllowed(await lookupIp(ip).catch(() => null)))) return end(c, 'country_not_allowed');

  await prisma.sessions.update({ where: { id: sid }, data: { confirmed_ips: withConfirmed(c.row.confirmed_ips, c.toApprove) } });
  await recordSecurityEvent({ type: 'session_ip_confirmed', severity: 'info', ip: c.ip, userId: c.session.userId, detail: { expected: c.row.ip_address, approved: c.toApprove, method: c.method } });
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  clearPendingAddresses(res);
  return res;
}
