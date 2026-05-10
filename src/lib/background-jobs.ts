import { prisma } from '@/lib/db';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Query all users who have access to at least one active mailbox
async function getActiveUsers() {
  return prisma.users.findMany({
    where: {
      OR: [
        { owned_mailboxes: { some: { is_active: true } } },
        { mailbox_permissions: { some: { can_view: true, mailbox: { is_active: true } } } },
      ],
    },
    select: { id: true, email: true },
  });
}

async function runOnce() {
  const { syncMailbox } = await import('@/lib/mail/sync');
  const { computeAndStoreMfi } = await import('@/app/api/mfi/compute');

  // 1. Sync all active mailboxes
  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true },
    select: { id: true },
  });
  await Promise.allSettled(mailboxes.map(mb => syncMailbox(mb.id)));

  // 2. Compute MFI for all users with mailbox access (personal + team)
  const users = await getActiveUsers();
  await Promise.allSettled(users.map(u => computeAndStoreMfi(u.id, u.email)));
}

// Use a global flag so Next.js HMR in dev doesn't spawn duplicate intervals
const STARTED_KEY = Symbol.for('__bg_jobs_started__');

export function startBackgroundJobs() {
  if (process.env.NODE_ENV === 'test') return;
  if ((global as any)[STARTED_KEY]) return;
  (global as any)[STARTED_KEY] = true;

  console.log('[background] jobs started (interval: 5 min)');

  // Run immediately after a short delay to let DB connections settle
  setTimeout(() => {
    runOnce().catch(e => console.error('[background] initial run error:', e));
    setInterval(() => {
      runOnce().catch(e => console.error('[background] interval run error:', e));
    }, INTERVAL_MS);
  }, 10_000);
}

// Exported for use by the cron endpoint — same logic, no rate limiting
export { getActiveUsers };
