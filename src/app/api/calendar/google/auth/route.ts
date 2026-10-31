import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { GOOGLE_CALENDAR_SCOPE, calendarRedirectUri } from '@/lib/google-calendar';

const OAUTH_STATE_COOKIE = 'gcal_oauth_state';

// GET /api/calendar/google/auth - start linking a Google calendar to my own calendar
export async function GET(_req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'google_not_configured' }, { status: 503 });

  // CSRF: random nonce in a cookie, echoed back through `state`.
  const nonce = randomBytes(16).toString('hex');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', calendarRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', nonce);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true, sameSite: 'lax', path: '/api/calendar/google', secure: process.env.NODE_ENV === 'production', maxAge: 600,
  });
  return res;
}
