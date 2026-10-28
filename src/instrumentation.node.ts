// Node.js runtime only — NOT bundled for Edge.
// Handles two sync modes per mailbox:
//   poll  — periodic interval sync (default, compatible with all servers)
//   idle  — IMAP IDLE push connection (instant delivery, requires server support)

import { prisma } from '@/lib/db';
import { syncMailbox } from '@/lib/mail/sync';
import { reconcileIdleConnections } from '@/lib/mail/idle';
import { runStaleUnreadAlerts } from '@/lib/background-jobs';
import { dispatchDueScheduledSends } from '@/lib/mail/deliver';
import { embeddingEnabled } from '@/lib/embedding';
import { indexPendingThreads } from '@/lib/semantic-search';
import { triggerFreeeSync } from '@/lib/freee-sync';
import { installSlowRequestLog } from '@/lib/slow-requests';

const DEFAULT_INTERVAL_SEC = 180;

// Log the requests that take over SLOW_REQUEST_MS (default 500), to find out which screen is slow.
installSlowRequestLog();

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
  // meaning-vectors for the semantic search (does nothing unless EMBEDDING_API_URL is set)
  if (embeddingEnabled()) await indexPendingThreads(50).catch(e => console.error('[embedding] index error:', e?.message || e));
  // money paid since the last round goes to freee (does nothing unless automatic sending is on)
  triggerFreeeSync();
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

// Weekly stale-unread DM — every Monday at 09:00 JST, tell each user about
// threads whose oldest unread message is 7+ days old. Checked every minute; the
// 09:00 hour fires at most once per day (lastAlertDate guard), so a restart during
// 09:00–09:59 still sends but a second in-process trigger can't. The 6-day DB
// throttle inside sendStaleUnreadDm additionally dedupes across restarts.
if (!g.__staleUnreadAlertStarted) {
  g.__staleUnreadAlertStarted = true;

  const jstClock = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', weekday: 'short', hour: 'numeric', hour12: false,
  });
  const jstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD

  let lastAlertDate = '';
  setInterval(() => {
    const now = new Date();
    const parts = Object.fromEntries(jstClock.formatToParts(now).map(p => [p.type, p.value]));
    const today = jstDate.format(now);
    if (parts.weekday === 'Mon' && Number(parts.hour) % 24 === 9 && lastAlertDate !== today) {
      lastAlertDate = today;
      console.log('[stale-unread] running weekly DM alerts');
      runStaleUnreadAlerts().catch(e => console.error('[stale-unread] alerts failed:', e));
    }
  }, 60 * 1000);

  console.log('[stale-unread] weekly DM alert job started (Mondays 09:00 JST)');
}

// Scheduled ("予約送信") emails — check every minute for anything whose
// scheduled_at has arrived and actually send it. This is the app's real dispatch
// path; /api/cron/scheduled-send is only a fallback for external-cron deployments.
if (!g.__scheduledSendStarted) {
  g.__scheduledSendStarted = true;

  const runScheduledSend = () =>
    dispatchDueScheduledSends()
      .then(({ dispatched }) => { if (dispatched > 0) console.log(`[scheduled-send] dispatched ${dispatched} message(s)`); })
      .catch(e => console.error('[scheduled-send] dispatch run failed:', e));

  setTimeout(runScheduledSend, 10_000);
  setInterval(runScheduledSend, 60 * 1000);

  console.log('[scheduled-send] dispatch job started (checks every 1m)');
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
