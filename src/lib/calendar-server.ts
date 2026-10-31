// DB side of the calendar: whose events a person sees, and who may change an event.
import { prisma } from '@/lib/db';
import { canViewCalendar, listCalendarMembers } from '@/lib/rbac';

/** Events a set of people have in their calendar: the ones they own and the ones they attend. */
export const inCalendarOf = (userIds: string[]) => ({ OR: [{ owner_user_id: { in: userIds } }, { attendees: { some: { user_id: { in: userIds } } } }] });

/** Whose calendar to show: just the person's own, or (with a shared mailbox) every member of it. Null = not allowed to look at that mailbox. */
export async function calendarPeople(userId: string, mailboxId: string | null): Promise<{ id: string; name: string }[] | null> {
  if (!mailboxId) {
    const me = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    return me ? [me] : null;
  }
  if (!(await canViewCalendar(userId, mailboxId))) return null;
  const members = await listCalendarMembers(mailboxId);
  return members.some(m => m.id === userId) ? members : [...members];
}

/** Who may change an event (title, time, attendees) or delete it: its owner and the person who made it. The people invited only look. */
export const canChangeEvent = (userId: string, ev: { owner_user_id: string; created_by_id: string | null }) =>
  ev.owner_user_id === userId || ev.created_by_id === userId;

/** The attendees to store: people of the company other than the owner, once each. Null when somebody is not a person of the company. */
export async function validAttendees(ids: string[] | undefined, ownerId: string): Promise<string[] | null> {
  const wanted = [...new Set(ids ?? [])].filter(id => id !== ownerId);
  if (wanted.length === 0) return [];
  const found = await prisma.users.findMany({ where: { id: { in: wanted }, locked_at: null }, select: { id: true } });
  return found.length === wanted.length ? wanted : null;
}
