// Node.js runtime only — NOT bundled for Edge.
// Sets up periodic IMAP sync for all active mailboxes.

import { prisma } from '@/lib/db';
import { syncMailbox } from '@/lib/mail/sync';

const DEFAULT_INTERVAL_SEC = 180;

async function getIntervalMs(): Promise<number> {
  try {
    const row = await prisma.app_settings.findUnique({ where: { key: 'SYNC_DEFAULT_INTERVAL_SEC' } });
    const sec = parseInt(row?.value || '', 10);
    return (Number.isFinite(sec) && sec >= 30 ? sec : DEFAULT_INTERVAL_SEC) * 1000;
  } catch {
    return DEFAULT_INTERVAL_SEC * 1000;
  }
}

async function runSync() {
  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true },
    select: { id: true, email_address: true }
  }).catch(() => [] as { id: string; email_address: string }[]);

  for (const mb of mailboxes) {
    try {
      const result = await syncMailbox(mb.id);
      if (result.synced > 0) {
        console.log(`[cron] ${mb.email_address}: ${result.synced} new message(s)`);
      }
    } catch (e: any) {
      console.error(`[cron] Sync failed for ${mb.email_address}:`, e?.message || e);
    }
  }
}

async function scheduleNext() {
  const intervalMs = await getIntervalMs();
  setTimeout(async () => {
    await runSync().catch(e => console.error('[cron] runSync error:', e));
    scheduleNext();
  }, intervalMs);
}

// Prevent duplicate loops on hot reload in development.
const g = globalThis as any;
if (!g.__imapSyncStarted) {
  g.__imapSyncStarted = true;

  // Run once shortly after startup, then loop with DB-configured interval.
  setTimeout(async () => {
    await runSync().catch(e => console.error('[cron] initial sync error:', e));
    scheduleNext();
  }, 10_000);

  console.log('[cron] IMAP auto-sync started (interval from DB: SYNC_DEFAULT_INTERVAL_SEC)');
}
