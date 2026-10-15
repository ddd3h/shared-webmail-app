import { prisma } from './db';
import { findStaleUnreadThreads } from './stale-unread';
import { sendStaleUnreadDm } from './mattermost-dm';

export async function getActiveUsers() {
  const users = await prisma.users.findMany({
    select: { id: true, email: true }
  });
  return users;
}

// Weekly DM listing threads whose oldest unread message is 7+ days old.
// Called on Monday mornings (scheduled in instrumentation.node.ts).
export async function runStaleUnreadAlerts() {
  const users = await getActiveUsers().catch(() => [] as { id: string; email: string }[]);
  for (const u of users) {
    try {
      const threads = await findStaleUnreadThreads(u.id);
      if (threads.length > 0) {
        await sendStaleUnreadDm(u.id, u.email, threads);
      }
    } catch (e: any) {
      console.error(`[stale-unread] alert failed for ${u.email}:`, e?.message || e);
    }
  }
}
