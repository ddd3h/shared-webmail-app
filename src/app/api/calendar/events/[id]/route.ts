import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canChangeEvent, validAttendees } from '@/lib/calendar-server';
import { notifyEventInvited } from '@/lib/work-notify';

const localSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  attendee_ids: z.array(z.string().min(1)).max(100).optional(),
  all_day: z.boolean().optional(),
  start_at: z.coerce.date().optional(),
  end_at: z.coerce.date().optional(),
});

// Imported events can only be renamed on our side; null/"" restores the Google/"予定あり" name.
const googleSchema = z.object({ title_override: z.string().trim().max(200).nullable() });

async function load(id: string) {
  return prisma.calendar_events.findUnique({ where: { id }, include: { attendees: { select: { user_id: true } } } });
}

// PATCH /api/calendar/events/:id - the owner (or whoever made it) changes it, including who takes part
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const ev = await load(id);
  if (!ev) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  if (ev.source === 'google') {
    if (ev.owner_user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const parsed = googleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    await prisma.calendar_events.update({ where: { id }, data: { title_override: parsed.data.title_override || null } });
    return NextResponse.json({ ok: true });
  }

  if (!canChangeEvent(session.userId, ev)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = localSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { attendee_ids, ...d } = parsed.data;
  const start = d.start_at ?? ev.start_at;
  const end = d.end_at ?? ev.end_at;
  if (end < start) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  let added: string[] = [];
  if (attendee_ids !== undefined) {
    const next = await validAttendees(attendee_ids, ev.owner_user_id);
    if (!next) return NextResponse.json({ error: 'invalid_attendee' }, { status: 400 });
    const had = new Set(ev.attendees.map(a => a.user_id));
    added = next.filter(u => !had.has(u));
    await prisma.$transaction([
      prisma.calendar_event_attendees.deleteMany({ where: { event_id: id, user_id: { notIn: next } } }),
      ...added.map(user_id => prisma.calendar_event_attendees.create({ data: { event_id: id, user_id } })),
    ]);
  }
  await prisma.calendar_events.update({
    where: { id },
    data: {
      ...d,
      description: d.description === undefined ? undefined : d.description || null,
      location: d.location === undefined ? undefined : d.location || null,
    },
  });
  if (added.length > 0) void notifyEventInvited(id, session.userId, added);
  return NextResponse.json({ ok: true });
}

// DELETE /api/calendar/events/:id - local events only (imported ones follow Google); the owner or whoever made it
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const ev = await load(id);
  if (!ev) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (ev.source === 'google') return NextResponse.json({ error: 'imported_event' }, { status: 400 });
  if (!canChangeEvent(session.userId, ev)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await prisma.calendar_events.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
