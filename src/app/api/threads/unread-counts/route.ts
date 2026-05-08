import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// GET /api/threads/unread-counts
// Returns unread thread counts for personal and team mailboxes.
// Much cheaper than fetching full thread lists.
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const userId = session!.userId;

  const mbAccessFilter = {
    OR: [
      { owner_user_id: userId },
      { permissions: { some: { user_id: userId, can_view: true } } },
    ],
  };

  // Personal unread: use the denormalized unread_count column
  const personal = await prisma.threads.count({
    where: {
      is_archived: false,
      status: { notIn: ['archived'] as any[] },
      unread_count: { gt: 0 },
      mailbox: { type: 'personal', ...mbAccessFilter },
      visibility: { none: { user_id: userId, is_hidden: true } },
    },
  });

  // Team unread: a thread is unread when the user has no read record,
  // or their last_read_at is before the thread's last_message_at.
  // Prisma cannot compare two columns directly, so use raw SQL.
  const rows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT t.id)::bigint AS count
    FROM threads t
    JOIN mailboxes mb ON t.mailbox_id = mb.id
    WHERE t.is_archived = false
      AND t.status != 'archived'
      AND mb.type = 'team'
      AND (
        mb.owner_user_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM mailbox_permissions mp
          WHERE mp.mailbox_id = mb.id AND mp.user_id = ${userId} AND mp.can_view = true
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_visibility tv
        WHERE tv.thread_id = t.id AND tv.user_id = ${userId} AND tv.is_hidden = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_reads tr
        WHERE tr.thread_id = t.id AND tr.user_id = ${userId} AND tr.last_read_at >= t.last_message_at
      )
  `;
  const team = Number(rows[0]?.count ?? 0);

  return NextResponse.json({ personal, team });
}
