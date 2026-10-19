import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canManageCalendar } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { syncLink } from '@/lib/google-calendar';

const schema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  display_mode: z.enum(['busy_only', 'full']).optional(),
  busy_label: z.string().trim().min(1).max(50).optional(),
  google_calendar_id: z.string().min(1).optional(),
});

// PATCH /api/calendar/links/:id - display settings / chosen Google calendar
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const link = await prisma.calendar_google_links.findUnique({ where: { id } });
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canManageCalendar(session.userId, link.mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;

  const calendarChanged = d.google_calendar_id !== undefined && d.google_calendar_id !== link.google_calendar_id;
  const modeChanged = d.display_mode !== undefined && d.display_mode !== link.display_mode;

  if (calendarChanged) {
    // Events of the previous calendar no longer belong to this link.
    await prisma.calendar_events.deleteMany({ where: { link_id: id } });
  } else if (modeChanged && d.display_mode === 'busy_only') {
    // Hiding details must also erase what was already stored.
    await prisma.calendar_events.updateMany({
      where: { link_id: id },
      data: { title: null, description: null, location: null },
    });
  }
  await prisma.calendar_google_links.update({ where: { id }, data: d });

  if (calendarChanged || modeChanged) {
    await syncLink(id).catch(() => {}); // error is recorded on the link
  }
  await logAudit({
    actorUserId: session.userId,
    actionType: 'calendar_link_update',
    targetType: 'calendar_google_link',
    targetId: id,
    metadata: { mailbox_id: link.mailbox_id, display_mode: d.display_mode },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/calendar/links/:id - unlink (imported events are removed with it)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const link = await prisma.calendar_google_links.findUnique({ where: { id } });
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canManageCalendar(session.userId, link.mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await prisma.calendar_google_links.delete({ where: { id } });
  await logAudit({
    actorUserId: session.userId,
    actionType: 'calendar_link_delete',
    targetType: 'calendar_google_link',
    targetId: id,
    metadata: { mailbox_id: link.mailbox_id },
  });
  return NextResponse.json({ ok: true });
}
