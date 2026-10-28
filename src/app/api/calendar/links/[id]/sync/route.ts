import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canEditCalendar } from '@/lib/rbac';
import { syncLink } from '@/lib/google-calendar';

// POST /api/calendar/links/:id/sync - manual refresh
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const link = await prisma.calendar_google_links.findUnique({ where: { id } });
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canEditCalendar(session.userId, link.mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json(await syncLink(id));
  } catch (e: any) {
    return NextResponse.json({ error: 'sync_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
