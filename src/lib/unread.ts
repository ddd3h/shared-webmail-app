import { prisma } from '@/lib/db';

export async function getUnreadCount(userId: string) {
  const [personal, team] = await Promise.all([
    prisma.threads.count({
      where: {
        mailbox: { type: 'personal', owner_user_id: userId },
        unread_count: { gt: 0 }
      }
    }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT t.id)::bigint as count
      FROM threads t
      JOIN mailboxes m ON t.mailbox_id = m.id
      JOIN mailbox_permissions p ON m.id = p.mailbox_id
      LEFT JOIN thread_reads r ON t.id = r.thread_id AND r.user_id = ${userId}
      WHERE m.type = 'team'
        AND p.user_id = ${userId}
        AND p.can_view = true
        AND (r.id IS NULL OR t.last_message_at > r.last_read_at)
    `
  ]);

  return {
    personal,
    team: Number(team[0]?.count || 0)
  };
}
