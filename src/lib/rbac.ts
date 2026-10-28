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

// Shared calendar permissions piggyback on the mailbox permissions:
//   view   = can_view   (see the calendar)
//   edit   = can_reply  (create/edit/delete events, rename imported events)
//   manage = can_assign (link/unlink Google calendars, change display settings)
export const canViewCalendar = canViewMailbox;
export const canEditCalendar = canReplyMailbox;
export const canManageCalendar = canAssignMailbox;

// A Google link belongs to the person who linked it: they can change it as long as
// they can still edit the calendar; managers can change anyone's.
export async function canManageCalendarLink(userId: string, link: { mailbox_id: string; linked_by_user_id: string }) {
  if (await canManageCalendar(userId, link.mailbox_id)) return true;
  return link.linked_by_user_id === userId && (await canEditCalendar(userId, link.mailbox_id));
}

// People whose schedules can be shown on a mailbox's calendar: everyone who can view it.
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
