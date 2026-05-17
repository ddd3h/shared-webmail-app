import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  // All team threads this user can view
  const threads = await prisma.threads.findMany({
    where: {
      mailbox: {
        type: 'team',
        permissions: { some: { user_id: session!.userId, can_view: true } },
      },
    },
    select: {
      id: true,
      subject: true,
      mailbox: { select: { display_name: true } },
      chat_messages: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: {
          id: true,
          body: true,
          kind: true,
          created_at: true,
          sender: { select: { name: true } },
          reads: { where: { user_id: session!.userId }, select: { id: true } },
        },
      },
    },
    orderBy: { last_message_at: 'desc' },
  });

  // Count unread chat messages per thread
  const unreadCounts = await prisma.chat_messages.groupBy({
    by: ['thread_id'],
    where: {
      thread_id: { in: threads.map(t => t.id) },
      reads: { none: { user_id: session!.userId } },
    },
    _count: { id: true },
  });
  const unreadMap = Object.fromEntries(unreadCounts.map(u => [u.thread_id, u._count.id]));

  const result = threads.map(t => {
    const last = t.chat_messages[0];
    return {
      threadId: t.id,
      threadSubject: t.subject,
      mailboxName: t.mailbox.display_name,
      lastMessage: last
        ? {
            body: last.body,
            kind: last.kind,
            senderName: last.sender.name,
            createdAt: last.created_at.toISOString(),
          }
        : null,
      unreadCount: unreadMap[t.id] ?? 0,
    };
  });

  return NextResponse.json(result);
}
