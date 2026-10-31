import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'google_not_configured' }, { status: 503 });

  // Normalize App URL and build redirect URI
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/contacts/google/callback`;
  
  // Full 'contacts' scope is needed for bidirectional sync (write access)
  const scope = 'https://www.googleapis.com/auth/contacts';

  console.log('[Google OAuth Auth] Initiating with Redirect URI:', redirectUri);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  // CSRF: a random value in a cookie, echoed back through `state`. (The person's id is public: it proves nothing, and a link that makes somebody
  // finish the login of ANOTHER Google account would put that account's address book into theirs.)
  const nonce = randomBytes(16).toString('hex');
  url.searchParams.set('state', nonce);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set('gcontacts_oauth_state', nonce, { httpOnly: true, sameSite: 'lax', path: '/api/contacts/google', secure: process.env.NODE_ENV === 'production', maxAge: 600 });
  return res;
}
