import { prisma } from '@/lib/db';

export async function getUserUnreadCounts(userId: string): Promise<{ personal: number; team: number }> {
  const personal = await prisma.threads.count({
    where: {
      is_archived: false,
      status: { notIn: ['archived'] as any[] },
      unread_count: { gt: 0 },
      mailbox: {
        type: 'personal',
        OR: [
          { owner_user_id: userId },
          { permissions: { some: { user_id: userId, can_view: true } } },
        ],
      },
      visibility: { none: { user_id: userId, is_hidden: true } },
    },
  });

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

  return { personal, team: Number(rows[0]?.count ?? 0) };
}
