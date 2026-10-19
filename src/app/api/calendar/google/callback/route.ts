import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canManageCalendar } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { calendarRedirectUri, sealToken } from '@/lib/google-calendar';

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const back = (q: string) => {
    const res = NextResponse.redirect(`${appUrl}/calendar?${q}`);
    res.cookies.delete({ name: 'gcal_oauth_state', path: '/api/calendar/google' });
    return res;
  };

  try {
    const session = await getSession();
    if (!session) return NextResponse.redirect(`${appUrl}/login`);

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const [nonce, mailboxId] = (url.searchParams.get('state') || '').split('.');
    const cookieNonce = req.cookies.get('gcal_oauth_state')?.value;
    if (!nonce || !mailboxId || nonce !== cookieNonce) return back('google_error=invalid_state');
    if (url.searchParams.get('error') || !code) return back(`mailbox=${mailboxId}&google_error=access_denied`);
    if (!(await canManageCalendar(session.userId, mailboxId))) return back('google_error=forbidden');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return back(`mailbox=${mailboxId}&google_error=not_configured`);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: calendarRedirectUri(), grant_type: 'authorization_code',
      }),
    });
    const body = await tokenRes.json();
    if (!tokenRes.ok || !body.refresh_token) {
      console.error('[Google Calendar callback] token exchange failed:', body.error);
      return back(`mailbox=${mailboxId}&google_error=token_exchange_failed`);
    }

    const link = await prisma.calendar_google_links.create({
      data: {
        mailbox_id: mailboxId,
        linked_by_user_id: session.userId,
        encrypted_token: await sealToken({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          expires_at: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
        }),
      },
    });
    await logAudit({
      actorUserId: session.userId,
      actionType: 'calendar_link_create',
      targetType: 'calendar_google_link',
      targetId: link.id,
      metadata: { mailbox_id: mailboxId },
    });
    // The UI then lets the user pick which Google calendar to import.
    return back(`mailbox=${mailboxId}&link=${link.id}`);
  } catch (err) {
    console.error('[Google Calendar callback] unexpected error:', err);
    return back('google_error=internal_error');
  }
}
