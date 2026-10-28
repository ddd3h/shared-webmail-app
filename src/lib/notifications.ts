// The notification list ("通知"): what happened that concerns me. Rows live in notification_events.
//  - new mail for the person (lib/mail/sync.ts) and generic pushes write their own rows;
//  - every direct message of lib/mattermost-dm.ts (requests, approvals, to-dos, payslips, security notes) is also recorded here by
//    sendDirectMessage, so the list is complete even where Mattermost is not set up.
import { prisma } from '@/lib/db';

export type NewNotification = { userId: string; type: string; title: string; body: string; url: string; priority?: 'low' | 'normal' | 'high' };

const TITLE_MAX = 120;
const BODY_MAX = 400;

// mmText() puts a backslash in front of markdown characters and a zero-width space after "@"; people should read the plain text.
const plain = (s: string) => s.replace(/\\([\\`*_{}\[\]()<>#+!|~])/g, '$1').replace(/\u200b/g, '').trim();

/** A link is only followed when it stays inside this app. */
export function safePath(url: string | null | undefined): string {
  if (!url) return '/notifications';
  if (/^\/(?![/\\])/.test(url)) return url;
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL;
    if (base) {
      const u = new URL(url), b = new URL(base);
      if (u.origin === b.origin) return `${u.pathname}${u.search}${u.hash}`;
    }
  } catch { /* not a URL */ }
  return '/notifications';
}

/** Turns the text of a Mattermost message ("🧾 **Title**\n\ndetails\n\nhttp://app/approvals") into a list entry. */
export function fromDirectMessage(message: string, appUrl: string): { title: string; body: string; url: string } {
  const lines = message.split(/\r?\n/);
  let url = '/notifications';
  const rest: string[] = [];
  let title = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!title) { title = plain(line.replace(/\*\*/g, '')); continue; }
    // a line that is only (or ends with) a link into this app is the destination; it is not repeated in the text
    const m = line.match(new RegExp(`${appUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^\\s)]*)?\\s*$`));
    if (m) {
      url = m[1] || '/';
      const before = line.slice(0, m.index).replace(/[:：\s]+$/, '').trim();
      if (before && !/^(承認・却下|修正して再申請)$/.test(before)) rest.push(plain(before.replace(/\*\*/g, '')));
      continue;
    }
    rest.push(plain(line.replace(/\*\*/g, '')));
  }
  return { title: title.slice(0, TITLE_MAX) || '通知', body: rest.join('\n').slice(0, BODY_MAX), url: safePath(url) };
}

export async function recordNotification(n: NewNotification): Promise<void> {
  try {
    await prisma.notification_events.create({
      data: { user_id: n.userId, thread_id: null, event_type: n.type, title: n.title.slice(0, TITLE_MAX), body: n.body.slice(0, BODY_MAX), url: safePath(n.url), priority: n.priority ?? 'normal' },
    });
  } catch (e) {
    console.error('[notifications] failed to record', n.type, e);
  }
}

export type NotificationItem = { id: string; type: string; title: string; body: string; url: string; created_at: Date; read: boolean };

export async function listNotifications(userId: string, o: { limit?: number; before?: Date; unreadOnly?: boolean } = {}) {
  const limit = Math.min(Math.max(o.limit ?? 30, 1), 100);
  const rows = await prisma.notification_events.findMany({
    where: { user_id: userId, ...(o.before ? { created_at: { lt: o.before } } : {}), ...(o.unreadOnly ? { read_at: null } : {}) },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const items: NotificationItem[] = page.map(r => ({ id: r.id, type: r.event_type, title: r.title, body: r.body, url: safePath(r.url), created_at: r.created_at, read: r.read_at !== null }));
  return { items, next: rows.length > limit ? page[page.length - 1].created_at : null };
}

export const unreadNotificationCount = (userId: string) => prisma.notification_events.count({ where: { user_id: userId, read_at: null } });

/** Marks the given notifications (or all) of this person as read. Other people's rows are never touched. */
export async function markNotificationsRead(userId: string, o: { ids?: string[]; all?: boolean }) {
  if (!o.all && !(o.ids && o.ids.length > 0)) return 0;
  const r = await prisma.notification_events.updateMany({
    where: { user_id: userId, read_at: null, ...(o.all ? {} : { id: { in: o.ids } }) },
    data: { read_at: new Date() },
  });
  return r.count;
}
