import { NextRequest, NextResponse } from 'next/server';
import { reauthenticate } from '@/lib/mfa-manage';
import { beginEnrollment } from '@/lib/mfa';
import { sealShort } from '@/lib/short-token';

// POST /api/security/mfa/setup { password } - start turning it on (or moving to a new phone): the secret and the QR code
export async function POST(req: NextRequest) {
  const r = await reauthenticate(req, { needCode: true }); // an existing factor must be confirmed before it can be replaced
  if (r instanceof NextResponse) return r;
  const e = await beginEnrollment(r.user.email);
  return NextResponse.json({ secret: e.secret, uri: e.uri, qr: e.qr, setup_token: await sealShort('mfa-enroll', { userId: r.user.id, secret: e.secret, login: false }) });
}
