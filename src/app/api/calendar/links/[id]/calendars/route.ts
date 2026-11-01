import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { GoogleListFailure, listGoogleCalendars } from '@/lib/google-calendar';

// GET /api/calendar/links/:id/calendars - Google calendars the linked account can read
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const link = await prisma.calendar_google_links.findUnique({ where: { id } });
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (link.linked_by_user_id !== session.userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json({ items: await listGoogleCalendars(link) });
  } catch (e) {
    // `error` says what to fix: api_disabled | insufficient_scope | token_expired | google_api_failed
    return NextResponse.json({ error: e instanceof GoogleListFailure ? e.code : 'google_api_failed' }, { status: 502 });
  }
}
