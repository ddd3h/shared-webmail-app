import { syncMailbox } from './mail/sync';
import { prisma } from './db';
import { computeAndStoreMfi } from '@/app/api/mfi/compute';

export async function getActiveUsers() {
  const users = await prisma.users.findMany({
    select: { id: true, email: true }
  });
  return users;
}

export async function runBackgroundSync() {
  console.log('[bg] Running global sync...');
  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true },
    select: { id: true, email_address: true }
  });

  for (const mb of mailboxes) {
    try {
      await syncMailbox(mb.id);
    } catch (e: any) {
      console.error(`[bg] Sync failed for ${mb.email_address}:`, e?.message || e);
    }
  }

  // 2. Compute MFI for all users with mailbox access (personal + team)
  const users = await getActiveUsers();
  await Promise.allSettled(users.map(u => computeAndStoreMfi(u.id)));
}

// Use a global flag so Next.js HMR in dev doesn't spawn duplicate intervals
let bgInterval: NodeJS.Timeout | null = null;

export function startBackgroundJobs() {
  if (bgInterval) return;
  // Run every 3 minutes
  bgInterval = setInterval(runBackgroundSync, 180 * 1000);
  console.log('[bg] Background jobs started (3m interval)');
}
