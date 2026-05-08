// Node.js runtime only — NOT bundled for Edge.
// Handles two sync modes per mailbox:
//   poll  — periodic interval sync (default, compatible with all servers)
//   idle  — IMAP IDLE push connection (instant delivery, requires server support)

import { prisma } from '@/lib/db';
import { syncMailbox } from '@/lib/mail/sync';
import { reconcileIdleConnections } from '@/lib/mail/idle';

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

// Sync only poll-mode mailboxes; IDLE-mode mailboxes are handled by idle.ts
async function runPollSync() {
  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true, sync_mode: 'poll' },
    select: { id: true, email_address: true },
  }).catch(() => [] as { id: string; email_address: string }[]);

  for (const mb of mailboxes) {
    try {
      const result = await syncMailbox(mb.id);
      if (result.synced > 0) {
        console.log(`[cron] ${mb.email_address}: ${result.synced} new message(s)`);
      }
    } catch (e: any) {
      console.error(`[cron] sync failed for ${mb.email_address}:`, e?.message || e);
    }
  }
}

async function tick() {
  await runPollSync().catch(e => console.error('[cron] poll error:', e));
  // Keep IDLE connections in sync with DB (picks up new/removed mailboxes)
  await reconcileIdleConnections().catch(e => console.error('[idle] reconcile error:', e));
}

async function scheduleNext() {
  const intervalMs = await getIntervalMs();
  setTimeout(async () => {
    await tick();
    scheduleNext();
  }, intervalMs);
}

// Prevent duplicate loops on hot reload in development.
const g = globalThis as any;
if (!g.__imapSyncStarted) {
  g.__imapSyncStarted = true;

  setTimeout(async () => {
    await tick();
    scheduleNext();
  }, 10_000);

  console.log('[cron] IMAP sync started — poll interval from SYNC_DEFAULT_INTERVAL_SEC, IDLE per mailbox');
}
