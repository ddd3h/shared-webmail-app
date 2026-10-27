import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { freeeAuthUrl, freeeRedirectUri, loadFreeeConfig } from '@/lib/freee';

const STATE_COOKIE = 'freee_oauth_state';

// GET /api/freee/auth - start connecting freee (system administrators only): sends the browser to freee's authorization screen
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const c = await loadFreeeConfig();
  if (!c.clientId || !c.hasSecret) return NextResponse.json({ error: 'freee_not_configured' }, { status: 409 });
  const nonce = randomBytes(16).toString('hex'); // CSRF: the same value comes back in `state`
  const url = new URL(`${freeeAuthUrl()}/public_api/authorize`);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('redirect_uri', freeeRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'select_company');
  url.searchParams.set('state', nonce);
  const res = NextResponse.redirect(url.toString());
  res.cookies.set(STATE_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', path: '/api/freee', secure: process.env.NODE_ENV === 'production', maxAge: 600 });
  return res;
}
