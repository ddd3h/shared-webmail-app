import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { gateAddress } from '@/lib/login-guard';
import { beginEnrollment, hasTotp } from '@/lib/mfa';
import { getClientIp } from '@/lib/rate-limit';
import { sealShort, unsealShort } from '@/lib/short-token';

// POST /api/auth/mfa/setup { challenge } — during a login of somebody without a second factor yet: the secret and the QR code.
// The secret is carried inside a sealed note; it is saved only after /enable has seen a correct code.
export async function POST(req: NextRequest) {
  const address = await gateAddress(getClientIp(req));
  if (!address.ok) return NextResponse.json({ error: address.error }, { status: address.status });
  const note = await unsealShort<{ userId: string }>('mfa-setup-login', (await req.json().catch(() => ({}))).challenge);
  if (!note) return NextResponse.json({ error: 'challenge_expired' }, { status: 401 });
  const user = await prisma.users.findUnique({ where: { id: note.userId } });
  if (!user || user.locked_at || hasTotp(user)) return NextResponse.json({ error: 'challenge_expired' }, { status: 401 });

  const e = await beginEnrollment(user.email);
  return NextResponse.json({ secret: e.secret, uri: e.uri, qr: e.qr, setup_token: await sealShort('mfa-enroll', { userId: user.id, secret: e.secret, login: true }) });
}
