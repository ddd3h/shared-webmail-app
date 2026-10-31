import { prisma } from '@/lib/db';

// Mailbox access check: owner always has full access; admins have no implicit bypass
// (admins grant themselves access via Settings → Permissions)
export async function canViewMailbox(userId: string, mailboxId: string) {
  const m = await prisma.mailboxes.findFirst({
    where: {
      id: mailboxId,
      OR: [
        { type: 'personal', owner_user_id: userId },
        { permissions: { some: { user_id: userId, can_view: true } } }
      ]
    }
  });
  return !!m;
}

export async function canReplyMailbox(userId: string, mailboxId: string) {
  const m = await prisma.mailboxes.findFirst({ where: { id: mailboxId } });
  if (!m) return false;
  if (m.type === 'personal' && m.owner_user_id === userId) return true;
  const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: mailboxId, user_id: userId, can_reply: true } });
  return !!perm;
}

export async function canAssignMailbox(userId: string, mailboxId: string) {
  const m = await prisma.mailboxes.findFirst({ where: { id: mailboxId } });
  if (!m) return false;
  if (m.type === 'personal' && m.owner_user_id === userId) return true;
  const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: mailboxId, user_id: userId, can_assign: true } });
  return !!perm;
}

// Calendars and to-dos belong to people. A shared mailbox only decides whose calendars you may look at:
// the people who can view that mailbox (members of the team) can look at each other's calendars and to-do lists.
export const canViewCalendar = canViewMailbox;

/** True when both people can view some shared mailbox: that is what lets them look at each other's calendar and give each other to-dos. */
export async function sharesMailbox(userId: string, otherId: string): Promise<boolean> {
  if (userId === otherId) return true;
  const rows = await prisma.mailbox_permissions.groupBy({ by: ['mailbox_id'], where: { user_id: { in: [userId, otherId] }, can_view: true }, _count: { user_id: true } });
  return rows.some(r => r._count.user_id === 2);
}

/** People who can view some mailbox that `userId` can view too (and the person themselves): whose lists a to-do may be put on. */
export async function listTeammates(userId: string) {
  const mine = await prisma.mailbox_permissions.findMany({ where: { user_id: userId, can_view: true }, select: { mailbox_id: true } });
  const others = mine.length === 0 ? [] : await prisma.mailbox_permissions.findMany({ where: { mailbox_id: { in: mine.map(m => m.mailbox_id) }, can_view: true }, select: { user_id: true } });
  const ids = new Set([userId, ...others.map(o => o.user_id)]);
  return prisma.users.findMany({ where: { id: { in: [...ids] }, locked_at: null }, select: { id: true, name: true }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
}

/** Everybody a person may add to an event or hand a to-do to: the people of the company (not locked). */
export async function listPeople() {
  return prisma.users.findMany({ where: { locked_at: null }, select: { id: true, name: true }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
}

// The members of a shared mailbox: everyone who can view it. Their calendars and to-do lists are what the mailbox shows.
export async function listCalendarMembers(mailboxId: string) {
  const mb = await prisma.mailboxes.findUnique({
    where: { id: mailboxId },
    select: { type: true, owner_user_id: true },
  });
  const perms = await prisma.mailbox_permissions.findMany({
    where: { mailbox_id: mailboxId, can_view: true },
    select: { user_id: true },
  });
  const ids = new Set(perms.map(p => p.user_id));
  if (mb?.type === 'personal' && mb.owner_user_id) ids.add(mb.owner_user_id);
  return prisma.users.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
}
