import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const teamThreadIds = await prisma.threads.findMany({
    where: {
      mailbox: {
        type: 'team',
        permissions: { some: { user_id: session!.userId, can_view: true } },
      },
    },
    select: { id: true },
  });

  const ids = teamThreadIds.map(t => t.id);
  if (ids.length === 0) return NextResponse.json({ count: 0 });

  const count = await prisma.chat_messages.count({
    where: {
      thread_id: { in: ids },
      reads: { none: { user_id: session!.userId } },
    },
  });

  return NextResponse.json({ count });
}
