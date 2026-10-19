import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canManageCalendar } from '@/lib/rbac';
import { listGoogleCalendars } from '@/lib/google-calendar';

// GET /api/calendar/links/:id/calendars - Google calendars the linked account can read
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const link = await prisma.calendar_google_links.findUnique({ where: { id } });
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canManageCalendar(session.userId, link.mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json({ items: await listGoogleCalendars(link) });
  } catch {
    return NextResponse.json({ error: 'google_api_failed' }, { status: 502 });
  }
}
