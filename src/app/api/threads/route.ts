import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { buildThreadsWhere, queryText, queryWithoutText } from '@/lib/threads-filter';
import { findSimilarThreads } from '@/lib/semantic-search';

const PAGE_LIMIT = 50;

const THREAD_SELECT = {
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
} satisfies Prisma.threadsSelect;

type ThreadRow = Prisma.threadsGetPayload<{ select: typeof THREAD_SELECT }>;

// GET /api/threads?status=open&type=team&q=keyword&mine=1&unread=1&cursor=<ISO>&cursor_id=<id>
// semantic=1 (with free words in q) also lists the threads close in meaning to those words, after the keyword hits.
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
  const spam = url.searchParams.get('spam') === '1';
  const semantic = url.searchParams.get('semantic') === '1';
  const cursorLast = url.searchParams.get('cursor') || undefined;
  const cursorId = url.searchParams.get('cursor_id') || undefined;

  let teamUnreadIds: string[] | undefined;
  if (unread && type === 'team') {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT t.id FROM threads t
      LEFT JOIN thread_reads r ON t.id = r.thread_id AND r.user_id = ${session!.userId}
      WHERE (r.id IS NULL OR t.last_message_at > r.last_read_at)
    `;
    teamUnreadIds = rows.map(r => r.id);
  }

  const filterParams = { session, status, type, mine, unread, sent, assigned, teamUnreadIds, spam };
  const threadsWhere = buildThreadsWhere({ ...filterParams, q });

  const threads = await prisma.threads.findMany({
    where: threadsWhere,
    orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
    // For cursor pagination: use last_message_at + id as composite cursor
    ...(cursorLast && cursorId ? {
      cursor: { id: cursorId },
      skip: 1,
    } : {}),
    // Always fetch one extra to detect next page
    take: PAGE_LIMIT + 1,
    select: THREAD_SELECT,
  });

  const toItem = (t: ThreadRow) => {
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
  };

  const items = threads.map(toItem);

  let finalItems = unread ? items.filter(i => i.unread_count > 0) : items;

  // Cursor-based pagination applies to all tabs
  let nextCursor: { last: string; id: string } | null = null;
  if (finalItems.length > PAGE_LIMIT) {
    finalItems = finalItems.slice(0, PAGE_LIMIT);
    const lastItem = finalItems[finalItems.length - 1];
    nextCursor = { last: (lastItem.last as unknown as Date).toISOString(), id: lastItem.id };
  }

  // Semantic search: threads that do not contain the words but are about the same thing, best match first.
  // The other filters (from:, status:, ...) still apply; the keyword hits are not repeated.
  type SemanticItem = ReturnType<typeof toItem> & { match: 'semantic'; score: number };
  let semanticItems: SemanticItem[] = [];
  let semanticUsed: boolean | undefined;
  const words = q ? queryText(q) : '';
  if (semantic && words && !cursorLast) {
    const narrowed = buildThreadsWhere({ ...filterParams, q: queryWithoutText(q!) || undefined });
    const hits = await findSimilarThreads({ AND: [narrowed, { NOT: threadsWhere }] }, words);
    semanticUsed = hits !== null;
    if (hits && hits.length > 0) {
      const rows = await prisma.threads.findMany({ where: { id: { in: hits.map(h => h.id) } }, select: THREAD_SELECT });
      const byId = new Map(rows.map(r => [r.id, r]));
      semanticItems = hits.flatMap(h => {
        const row = byId.get(h.id);
        return row ? [{ ...toItem(row), match: 'semantic' as const, score: Math.round(h.score * 100) / 100 }] : [];
      });
    }
  }

  // Check which threads have a saved draft by the current user
  const draftedThreadIds = new Set(
    (await prisma.drafts.findMany({
      where: { user_id: session!.userId, thread_id: { in: [...finalItems, ...semanticItems].map(i => i.id) } },
      select: { thread_id: true }
    })).map(d => d.thread_id).filter((tid): tid is string => tid !== null)
  );

  const withDraft = <T extends { id: string }>(list: T[]) => list.map(i => ({ ...i, has_draft: draftedThreadIds.has(i.id) }));

  // Also return total count for 'Select all' UI
  const totalCount = await prisma.threads.count({ where: threadsWhere }) + semanticItems.length;

  return NextResponse.json({
    items: [...withDraft(finalItems), ...withDraft(semanticItems)],
    nextCursor,
    totalCount,
    ...(semanticUsed === undefined ? {} : { semantic: { used: semanticUsed, count: semanticItems.length } }),
  });
}
