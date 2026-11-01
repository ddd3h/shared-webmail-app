import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { listPeople } from '@/lib/rbac';
import { displayTitle, canShowDetails } from '@/lib/calendar';
import { syncStaleLinks } from '@/lib/google-calendar';
import { calendarPeople, canChangeEvent, inCalendarOf, validAttendees } from '@/lib/calendar-server';
import { notifyEventInvited } from '@/lib/work-notify';

// GET /api/calendar/events?from=&to=[&mailboxId=]
// Everybody has one calendar: the events they own and the ones they attend. With a shared mailbox, the same for each member of it
// (you see the calendars of the people of that team, nobody else's).
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const sp = new URL(req.url).searchParams;
  const mailboxId = sp.get('mailboxId') || null;
  const from = new Date(sp.get('from') || '');
  const to = new Date(sp.get('to') || '');
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const people = await calendarPeople(session.userId, mailboxId);
  if (!people) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ids = people.map(p => p.id);

  await syncStaleLinks(ids);

  const [rows, links, everybody] = await Promise.all([
    prisma.calendar_events.findMany({
      where: { start_at: { lt: to }, end_at: { gt: from }, ...inCalendarOf(ids) },
      include: {
        link: { select: { id: true, name: true, color: true, display_mode: true, busy_label: true } },
        owner: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
        attendees: { select: { user: { select: { id: true, name: true } } }, orderBy: { created_at: 'asc' } },
      },
      orderBy: { start_at: 'asc' },
    }),
    // a person links their own Google calendars (only their own are listed)
    prisma.calendar_google_links.findMany({
      where: { linked_by_user_id: session.userId },
      select: { id: true, name: true, color: true, display_mode: true, busy_label: true, google_calendar_id: true, last_synced_at: true, last_error: true, linked_by_user_id: true, linked_by: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
    }),
    listPeople(),
  ]);

  // Never send stored details of imported events unless the link shows them.
  const items = rows.map(e => {
    const details = canShowDetails(e);
    return {
      id: e.id,
      source: e.source,
      title: displayTitle(e),
      renamed: !!e.title_override?.trim(),
      original_title: details ? e.title : null,
      description: details ? e.description : null,
      location: details ? e.location : null,
      all_day: e.all_day,
      start_at: e.start_at,
      end_at: e.end_at,
      color: e.link?.color ?? null,
      link_name: e.link?.name ?? null,
      owner: { id: e.owner.id, name: e.owner.name },
      attendees: e.attendees.map(a => a.user),
      created_by: e.creator?.name ?? null,
      // the owner (and whoever made it) changes it; an imported event can only be renamed, by its owner
      can_edit: e.source === 'google' ? e.owner_user_id === session.userId : canChangeEvent(session.userId, e),
    };
  });

  return NextResponse.json({
    items,
    people,           // whose calendars are shown: just me, or the members of the chosen shared mailbox
    everybody,        // everybody who can be invited to an event
    me: session.userId,
    links,
    google_configured: !!process.env.GOOGLE_CLIENT_ID,
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(200).optional(),
  attendee_ids: z.array(z.string().min(1)).max(100).optional(),
  all_day: z.boolean().default(false),
  start_at: z.coerce.date(),
  end_at: z.coerce.date(),
}).refine(v => v.end_at >= v.start_at, { message: 'end_before_start' });

// POST /api/calendar/events - create an event in my calendar, with the people who take part (it shows in their calendars too)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { attendee_ids, ...data } = parsed.data;
  const attendees = await validAttendees(attendee_ids, session.userId);
  if (!attendees) return NextResponse.json({ error: 'invalid_attendee' }, { status: 400 });
  const created = await prisma.calendar_events.create({
    data: {
      ...data,
      description: data.description || null,
      location: data.location || null,
      source: 'local',
      owner_user_id: session.userId,
      created_by_id: session.userId,
      attendees: { create: attendees.map(user_id => ({ user_id })) },
    },
  });
  if (attendees.length > 0) void notifyEventInvited(created.id, session.userId, attendees);
  return NextResponse.json({ id: created.id }, { status: 201 });
}
