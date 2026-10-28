// Which shared mailboxes a person sees in their 共有メール view. They may view several; each person can leave some out
// (hidden_team_mailboxes). What is left out is absent from the list, from the 共有メール unread number and from the badge,
// but a search still looks in every mailbox the person may view.
import { prisma } from '@/lib/db';

export type TeamMailbox = { id: string; name: string; shown: boolean; unread: number };

export async function hiddenTeamMailboxIds(userId: string): Promise<string[]> {
  return (await prisma.hidden_team_mailboxes.findMany({ where: { user_id: userId }, select: { mailbox_id: true } })).map(r => r.mailbox_id);
}

/** The shared mailboxes the person may view, with whether each is shown and how many threads in it are unread (for them). */
export async function listTeamMailboxes(userId: string): Promise<TeamMailbox[]> {
  const [boxes, hidden, unread] = await Promise.all([
    prisma.mailboxes.findMany({
      where: { type: 'team', is_active: true, permissions: { some: { user_id: userId, can_view: true } } },
      select: { id: true, display_name: true }, orderBy: { display_name: 'asc' },
    }),
    hiddenTeamMailboxIds(userId),
    prisma.$queryRaw<{ mailbox_id: string; n: bigint }[]>`
      SELECT t.mailbox_id, COUNT(DISTINCT t.id)::bigint AS n
      FROM threads t
      JOIN mailboxes m ON t.mailbox_id = m.id
      JOIN mailbox_permissions p ON m.id = p.mailbox_id AND p.user_id = ${userId} AND p.can_view = true
      LEFT JOIN thread_reads r ON t.id = r.thread_id AND r.user_id = ${userId}
      WHERE m.type = 'team' AND t.is_spam = false AND (r.id IS NULL OR t.last_message_at > r.last_read_at)
      GROUP BY t.mailbox_id`,
  ]);
  const n = new Map(unread.map(u => [u.mailbox_id, Number(u.n)]));
  return boxes.map(b => ({ id: b.id, name: b.display_name, shown: !hidden.includes(b.id), unread: n.get(b.id) ?? 0 }));
}

/** Saves which ones are hidden. Only mailboxes the person may view count, and at least one has to stay shown. */
export async function setHiddenTeamMailboxes(userId: string, hiddenIds: string[]): Promise<{ ok: true } | { ok: false; error: 'all_hidden' }> {
  const boxes = await listTeamMailboxes(userId);
  const viewable = new Set(boxes.map(b => b.id));
  const hidden = [...new Set(hiddenIds)].filter(id => viewable.has(id));
  if (boxes.length > 0 && hidden.length >= boxes.length) return { ok: false, error: 'all_hidden' };
  await prisma.$transaction([
    prisma.hidden_team_mailboxes.deleteMany({ where: { user_id: userId } }),
    prisma.hidden_team_mailboxes.createMany({ data: hidden.map(mailbox_id => ({ user_id: userId, mailbox_id })) }),
  ]);
  return { ok: true };
}
