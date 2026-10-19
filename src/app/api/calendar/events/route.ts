import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canViewCalendar, canEditCalendar, canManageCalendar } from '@/lib/rbac';
import { displayTitle, canShowDetails } from '@/lib/calendar';
import { syncStaleLinks } from '@/lib/google-calendar';

// GET /api/calendar/events?mailboxId=&from=&to=
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const sp = new URL(req.url).searchParams;
  const mailboxId = sp.get('mailboxId') || '';
  const from = new Date(sp.get('from') || '');
  const to = new Date(sp.get('to') || '');
  if (!mailboxId || isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  if (!(await canViewCalendar(session.userId, mailboxId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await syncStaleLinks(mailboxId);

  const [rows, canEdit, canManage] = await Promise.all([
    prisma.calendar_events.findMany({
      where: { mailbox_id: mailboxId, start_at: { lt: to }, end_at: { gt: from } },
      include: {
        link: { select: { id: true, name: true, color: true, display_mode: true, busy_label: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: { start_at: 'asc' },
    }),
    canEditCalendar(session.userId, mailboxId),
    canManageCalendar(session.userId, mailboxId),
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
      created_by: e.creator?.name ?? null,
    };
  });

  const links = canManage
    ? await prisma.calendar_google_links.findMany({
        where: { mailbox_id: mailboxId },
        select: {
          id: true, name: true, color: true, display_mode: true, busy_label: true,
          google_calendar_id: true, last_synced_at: true, last_error: true,
          linked_by: { select: { name: true } },
        },
        orderBy: { created_at: 'asc' },
      })
    : [];

  return NextResponse.json({
    items,
    permissions: { can_edit: canEdit, can_manage: canManage },
    links,
    google_configured: !!process.env.GOOGLE_CLIENT_ID,
  });
}

const createSchema = z.object({
  mailboxId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(200).optional(),
  all_day: z.boolean().default(false),
  start_at: z.coerce.date(),
  end_at: z.coerce.date(),
}).refine(v => v.end_at >= v.start_at, { message: 'end_before_start' });

// POST /api/calendar/events - create a local event
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { mailboxId, ...data } = parsed.data;
  if (!(await canEditCalendar(session.userId, mailboxId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const created = await prisma.calendar_events.create({
    data: {
      ...data,
      description: data.description || null,
      location: data.location || null,
      mailbox_id: mailboxId,
      source: 'local',
      created_by_id: session.userId,
    },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
