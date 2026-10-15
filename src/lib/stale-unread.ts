import { prisma } from '@/lib/db';

export type StaleUnreadThread = {
  thread_id: string;
  subject: string;
  oldest_unread_at: Date;
};

export const STALE_UNREAD_DAYS = 7;

// Threads where the user's oldest unread message arrived at least `olderThanDays` ago.
//
// "Unread" follows the same rules as the thread list (api/threads/route.ts):
//  - personal mailbox: threads.unread_count > 0. The unread messages are the newest
//    `unread_count` incoming messages of the thread.
//  - team mailbox (can_view): no thread_reads row, or last_message_at > last_read_at.
//    The unread messages are the incoming ones received after last_read_at.
export async function findStaleUnreadThreads(
  userId: string,
  olderThanDays = STALE_UNREAD_DAYS,
  now = new Date()
): Promise<StaleUnreadThread[]> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 3600 * 1000);

  return prisma.$queryRaw<StaleUnreadThread[]>`
    WITH incoming AS (
      SELECT m.thread_id,
             COALESCE(m.received_at, m.sent_at) AS at,
             ROW_NUMBER() OVER (
               PARTITION BY m.thread_id ORDER BY COALESCE(m.received_at, m.sent_at) DESC
             ) AS rn
      FROM messages m
      WHERE m.direction = 'incoming'
    ),
    stale AS (
      SELECT t.id AS thread_id, t.subject, MIN(i.at) AS oldest_unread_at
      FROM threads t
      JOIN mailboxes mb ON mb.id = t.mailbox_id
      JOIN incoming i ON i.thread_id = t.id AND i.rn <= t.unread_count
      WHERE mb.type = 'personal'
        AND mb.owner_user_id = ${userId}
        AND t.unread_count > 0
        AND t.is_spam = false
      GROUP BY t.id, t.subject

      UNION ALL

      SELECT t.id AS thread_id, t.subject, MIN(i.at) AS oldest_unread_at
      FROM threads t
      JOIN mailboxes mb ON mb.id = t.mailbox_id
      JOIN mailbox_permissions p
        ON p.mailbox_id = mb.id AND p.user_id = ${userId} AND p.can_view = true
      LEFT JOIN thread_reads r ON r.thread_id = t.id AND r.user_id = ${userId}
      JOIN incoming i ON i.thread_id = t.id AND (r.id IS NULL OR i.at > r.last_read_at)
      WHERE mb.type = 'team'
        AND t.is_spam = false
        AND (r.id IS NULL OR t.last_message_at > r.last_read_at)
      GROUP BY t.id, t.subject
    )
    SELECT thread_id, subject, oldest_unread_at
    FROM stale
    WHERE oldest_unread_at <= ${cutoff}
    ORDER BY oldest_unread_at ASC
  `;
}
