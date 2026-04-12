import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { encrypt } from '@/lib/crypto';

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.redirect(`${appUrl}/login`);
    }

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error || !code) {
      console.error('[Google OAuth callback] error param:', error);
      return NextResponse.redirect(`${appUrl}/admin/settings?google_error=access_denied`);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${appUrl}/admin/settings?google_error=not_configured`);
    }

    const redirectUri = `${appUrl}/api/contacts/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    });

    const tokenBody = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('[Google OAuth callback] token exchange failed:', JSON.stringify(tokenBody));
      const detail = encodeURIComponent(tokenBody.error_description || tokenBody.error || 'unknown');
      return NextResponse.redirect(`${appUrl}/admin/settings?google_error=token_exchange_failed&detail=${detail}`);
    }

    const expiresAt = new Date(Date.now() + (tokenBody.expires_in ?? 3600) * 1000).toISOString();
    const tokenJson = JSON.stringify({ access_token: tokenBody.access_token, refresh_token: tokenBody.refresh_token, expires_at: expiresAt });
    const encryptedToken = await encrypt(tokenJson);

    await prisma.google_oauth_tokens.upsert({
      where: { user_id: session.userId },
      create: { user_id: session.userId, encrypted_token: encryptedToken },
      update: { encrypted_token: encryptedToken }
    });

    return NextResponse.redirect(`${appUrl}/admin/settings?google_linked=1`);
  } catch (err) {
    console.error('[Google OAuth callback] unexpected error:', err);
    return NextResponse.redirect(`${appUrl}/admin/settings?google_error=internal_error`);
  }
}
