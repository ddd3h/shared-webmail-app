import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

/**
 * Parse a search query string into structured filters.
 *
 * Message-level prefixes:
 *   from:name/email   - sender filter
 *   to:address        - recipient filter
 *   cc:address        - CC filter
 *   bcc:address       - BCC filter
 *   subject:text      - subject-only filter
 *   body:text         - body-only filter
 *   has:attachment    - has attachments
 *   after:YYYY-MM-DD  - sent after date
 *   before:YYYY-MM-DD - sent before date
 * Thread-level prefixes:
 *   mailbox:name      - mailbox display_name filter
 *   status:value      - thread status filter (open/in_progress/done/waiting)
 *   assigned:name     - assigned user name filter
 * Everything else: full-text (subject + body + sender + recipients)
 */
function parseQuery(raw: string) {
  const tokens = raw.trim().split(/\s+/);
  const filters = {
    from: [] as string[],
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
    subject: [] as string[],
    body: [] as string[],
    text: [] as string[],
    hasAttachment: false,
    after: null as Date | null,
    before: null as Date | null,
    mailbox: [] as string[],
    status: [] as string[],
    assigned: [] as string[],
  };

  const STATUS_MAP: Record<string, string> = {
    '未対応': 'open', 'open': 'open',
    '対応中': 'in_progress', 'in_progress': 'in_progress',
    '完了': 'done', 'done': 'done',
    '保留': 'waiting', 'waiting': 'waiting',
    'archived': 'archived',
  };

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === 'has:attachment') { filters.hasAttachment = true; continue; }
    const colonIdx = tok.indexOf(':');
    if (colonIdx > 0) {
      const prefix = lower.slice(0, colonIdx);
      const val = tok.slice(colonIdx + 1);
      if (!val) continue;
      if (prefix === 'from') { filters.from.push(val); continue; }
      if (prefix === 'to') { filters.to.push(val); continue; }
      if (prefix === 'cc') { filters.cc.push(val); continue; }
      if (prefix === 'bcc') { filters.bcc.push(val); continue; }
      if (prefix === 'subject') { filters.subject.push(val); continue; }
      if (prefix === 'body') { filters.body.push(val); continue; }
      if (prefix === 'mailbox') { filters.mailbox.push(val); continue; }
      if (prefix === 'status') { const s = STATUS_MAP[val] || STATUS_MAP[val.toLowerCase()] || val; filters.status.push(s); continue; }
      if (prefix === 'assigned') { filters.assigned.push(val); continue; }
      if (prefix === 'after') { const d = new Date(val); if (!isNaN(d.getTime())) { filters.after = d; } continue; }
      if (prefix === 'before') { const d = new Date(val); if (!isNaN(d.getTime())) { filters.before = new Date(d.getTime() + 86400000); } continue; }
    }
    filters.text.push(tok);
  }
  return filters;
}

const PAGE_LIMIT = 50;

// GET /api/threads?status=open&type=team&q=keyword&mine=1&unread=1&cursor=<ISO>&cursor_id=<id>
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const type = url.searchParams.get('type') || undefined;
  const q = url.searchParams.get('q') || undefined;
  const mine = url.searchParams.get('mine') === '1';
  const unread = url.searchParams.get('unread') === '1';
  const sent = url.searchParams.get('sent') === '1';
  const assigned = url.searchParams.get('assigned') === '1';
  const cursorLast = url.searchParams.get('cursor') || undefined;
  const cursorId = url.searchParams.get('cursor_id') || undefined;

  // Build message-level and thread-level conditions for search
  let messageWhere: Record<string, unknown> | undefined;
  const threadSearchClauses: object[] = [];
  if (q) {
    const f = parseQuery(q);
    const andClauses: object[] = [];

    // Free-text terms: match subject OR body OR sender/recipients
    for (const term of f.text) {
      andClauses.push({
        OR: [
          { subject: { contains: term, mode: 'insensitive' } },
          { text_body: { contains: term, mode: 'insensitive' } },
          { from_name: { contains: term, mode: 'insensitive' } },
          { from_email: { contains: term, mode: 'insensitive' } },
          { to_raw: { contains: term, mode: 'insensitive' } },
          { cc_raw: { contains: term, mode: 'insensitive' } },
        ]
      });
    }

    // from: filter
    for (const val of f.from) {
      andClauses.push({
        OR: [
          { from_name: { contains: val, mode: 'insensitive' } },
          { from_email: { contains: val, mode: 'insensitive' } },
        ]
      });
    }

    // to: filter
    for (const val of f.to) {
      andClauses.push({ to_raw: { contains: val, mode: 'insensitive' } });
    }

    // cc: filter
    for (const val of f.cc) {
      andClauses.push({ cc_raw: { contains: val, mode: 'insensitive' } });
    }

    // bcc: filter
    for (const val of f.bcc) {
      andClauses.push({ bcc_raw: { contains: val, mode: 'insensitive' } });
    }

    // subject: filter
    for (const val of f.subject) {
      andClauses.push({ subject: { contains: val, mode: 'insensitive' } });
    }

    // body: filter (text body only)
    for (const val of f.body) {
      andClauses.push({ text_body: { contains: val, mode: 'insensitive' } });
    }

    // has:attachment
    if (f.hasAttachment) andClauses.push({ has_attachments: true });

    // date range
    if (f.after) andClauses.push({ sent_at: { gte: f.after } });
    if (f.before) andClauses.push({ sent_at: { lt: f.before } });

    if (andClauses.length > 0) {
      messageWhere = (andClauses.length === 1 ? andClauses[0] : { AND: andClauses }) as Record<string, unknown>;
    }

    // Thread-level filters (mailbox, status, assigned)
    for (const val of f.mailbox) {
      threadSearchClauses.push({ mailbox: { display_name: { contains: val, mode: 'insensitive' } } });
    }
    for (const val of f.status) {
      threadSearchClauses.push({ status: val as any });
    }
    for (const val of f.assigned) {
      threadSearchClauses.push({ assigned_user: { name: { contains: val, mode: 'insensitive' } } });
    }
  }

  const threads = await prisma.threads.findMany({
    where: {
      ...(status ? { status: status as any } : { status: { notIn: ['archived'] } }),
      ...(mine ? { assigned_user_id: session!.userId, status: { in: ['open', 'in_progress', 'waiting'] } } : {}),
      ...(assigned ? { assigned_user_id: { not: null } } : {}),

      // Unread filter at DB level for efficient pagination:
      // - personal: unread_count > 0 (exact)
      // - team: no read record for this user (threads read-then-updated also
      //   caught by the client-side isUnreadForUser check below)
      ...(unread && type === 'personal' ? { unread_count: { gt: 0 } } : {}),
      ...(unread && type === 'team' ? { reads: { none: { user_id: session!.userId } } } : {}),

      // Thread filter logic:
      // - Sent: contains at least one outgoing message
      // - All/Unread (default): show any thread that has messages matching search
      ...(sent
        ? { messages: { some: { direction: 'outgoing' } } }
        : messageWhere
          ? { messages: { some: messageWhere } }
          : {}),

      // Thread-level search filters (mailbox:, status:, assigned: from q)
      ...(threadSearchClauses.length > 0 ? { AND: threadSearchClauses } : {}),

      mailbox: {
        ...(type ? { type: type as any } : {}),
        // Everyone (including admins) sees only their own + permitted mailboxes.
        // Admins can manage these permissions in Settings.
        OR: [
          { owner_user_id: session!.userId },
          { permissions: { some: { user_id: session!.userId, can_view: true } } }
        ]
      },
      // Exclude user-hidden threads
      visibility: {
        none: {
          user_id: session!.userId,
          is_hidden: true
        }
      }
    },
    orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
    // For cursor pagination: use last_message_at + id as composite cursor
    ...(cursorLast && cursorId ? {
      cursor: { id: cursorId },
      skip: 1,
    } : {}),
    // Always fetch one extra to detect next page
    take: PAGE_LIMIT + 1,
    select: {
      id: true,
      subject: true,
      status: true,
      last_message_at: true,
      unread_count: true,
      mailbox: { select: { id: true, display_name: true, type: true } },
      assigned_user: { select: { name: true } },
      last_replied_by: { select: { name: true } },
      mattermost: { select: { id: true } },
      messages: {
        take: 1,
        orderBy: { sent_at: 'asc' },
        select: { from_email: true, from_name: true }
      },
      reads: {
        select: {
          last_read_at: true,
          user_id: true,
          user: { select: { id: true, name: true, mattermost_user_id: true } }
        }
      }
    }
  });

  const items = threads.map((t) => {
    // For team threads: unread = no read record OR last_message_at > last_read_at
    const userRead = t.reads.find(r => r.user_id === session!.userId);
    const isUnreadForUser = t.mailbox.type === 'team'
      ? (!userRead || t.last_message_at > userRead.last_read_at)
      : t.unread_count > 0;

    // Readers: users who have read (for team mail)
    const readers = t.mailbox.type === 'team'
      ? t.reads
          .filter(r => !(!r.user_id || (t.last_message_at > r.last_read_at)))
          .map(r => ({ id: r.user.id, name: r.user.name, mattermost_user_id: r.user.mattermost_user_id }))
      : [];

    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      last: t.last_message_at,
      unread_count: isUnreadForUser ? 1 : 0,
      mailbox: t.mailbox.display_name,
      mailbox_type: t.mailbox.type,
      mailbox_id: t.mailbox.id,
      assigned: t.assigned_user?.name || null,
      last_replied_by: t.last_replied_by?.name || null,
      has_mattermost: !!t.mattermost,
      from_email: t.messages[0]?.from_email || null,
      from_name: t.messages[0]?.from_name || null,
      readers
    };
  });

  let finalItems = unread ? items.filter(i => i.unread_count > 0) : items;

  // Cursor-based pagination applies to all tabs
  let nextCursor: { last: string; id: string } | null = null;
  if (finalItems.length > PAGE_LIMIT) {
    finalItems = finalItems.slice(0, PAGE_LIMIT);
    const lastItem = finalItems[finalItems.length - 1];
    nextCursor = { last: (lastItem.last as unknown as Date).toISOString(), id: lastItem.id };
  }

  return NextResponse.json({ items: finalItems, nextCursor });
}
