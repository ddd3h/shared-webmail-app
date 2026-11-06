import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { beginPasskeyReauth, hasPasskey } from '@/lib/passkey-reauth';
import { checkRateLimit } from '@/lib/rate-limit';

// POST /api/auth/reauth/options - how this person proves it again: with their passkey (a challenge for it is returned), or with the password.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  if (!(await hasPasskey(session.userId))) return NextResponse.json({ method: 'password' });
  const limit = checkRateLimit(`reauth-options:${session.userId}`, 20, 15 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
  const options = await beginPasskeyReauth(session.userId, req.headers.get('origin'));
  if (!options) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  return NextResponse.json({ method: 'passkey', options });
}
