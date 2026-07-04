// Node.js runtime only — NOT bundled for Edge.
// Handles two sync modes per mailbox:
//   poll  — periodic interval sync (default, compatible with all servers)
//   idle  — IMAP IDLE push connection (instant delivery, requires server support)

import { prisma } from '@/lib/db';
import { syncMailbox } from '@/lib/mail/sync';
import { reconcileIdleConnections } from '@/lib/mail/idle';
import { computeMfiForAllUsers } from '@/lib/background-jobs';

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

// MFI snapshots — record for ALL users regardless of dashboard access.
// Check every 15 minutes; actual writes are gated to once per 4 hours per user
// by shouldCreateSnapshot() inside computeAndStoreMfi, so the short check
// interval only bounds the drift past the 4-hour mark (worst case +15 min,
// e.g. after a server restart).
if (!g.__mfiSnapshotStarted) {
  g.__mfiSnapshotStarted = true;

  const runMfi = () =>
    computeMfiForAllUsers().catch(e => console.error('[mfi] snapshot run failed:', e));

  // First run shortly after startup to fill any gap from downtime.
  setTimeout(runMfi, 15_000);
  setInterval(runMfi, 15 * 60 * 1000);

  console.log('[mfi] snapshot job started (15m check, 4h write cadence)');
}

// Cleanup expired sessions daily to prevent unbounded table growth
if (!g.__sessionCleanupStarted) {
  g.__sessionCleanupStarted = true;
  setInterval(() => {
    prisma.sessions.deleteMany({ where: { expires_at: { lt: new Date() } } })
      .then(r => { if (r.count > 0) console.log(`[session-cleanup] deleted ${r.count} expired sessions`); })
      .catch(e => console.error('[session-cleanup] failed:', e));
  }, 24 * 60 * 60 * 1000);
}

// Run the collaborative-editing (y-websocket) server IN-PROCESS, so a single
// `pm2 start shared-webmail-app` brings up everything. It listens on COLLAB_PORT
// (default 1234); nginx proxies wss://<host>/collab → it.
if (!g.__collabStarted) {
  g.__collabStarted = true;
  Promise.all([import('node:path'), import('@/lib/collab/embedded')]).then(([path, { startEmbeddedCollab }]) => {
    // In a standalone build the server cwd is <root>/.next/standalone, whose
    // minimal node_modules lacks y-websocket — resolve back to the project root.
    const cwd = process.cwd();
    const standaloneSuffix = path.join('.next', 'standalone');
    const projectRoot = cwd.endsWith(standaloneSuffix) ? path.resolve(cwd, '..', '..') : cwd;
    startEmbeddedCollab(projectRoot);
  }).catch(e => console.error('[collab] failed to start:', e));
}
