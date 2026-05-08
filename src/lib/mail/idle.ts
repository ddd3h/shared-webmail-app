// IMAP IDLE manager — maintains persistent push connections per mailbox.
// Uses imapflow's auto-IDLE + 'exists' event to detect new messages without polling.
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { syncMailbox } from './sync';

type ImapFlowCtor = typeof import('imapflow').ImapFlow;

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// mailboxId -> true (running) | false (stop requested)
const state = new Map<string, boolean>();

async function connectAndWatch(
  mailboxId: string,
  email: string,
  creds: { host: string; port: number; secure: boolean; user: string; pass: string },
): Promise<void> {
  const { ImapFlow } = (await import('imapflow')) as { ImapFlow: ImapFlowCtor };
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  } as any);

  let debounce: ReturnType<typeof setTimeout> | null = null;

  const scheduleSync = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      syncMailbox(mailboxId).catch(e =>
        console.error(`[idle] ${email}: sync error:`, e?.message),
      );
    }, 2_000);
  };

  client.on('exists', (data: { count: number; prevCount: number }) => {
    if (data.count > data.prevCount) {
      console.log(`[idle] ${email}: EXISTS ${data.prevCount} → ${data.count}`);
      scheduleSync();
    }
  });

  const closePromise = new Promise<void>((resolve, reject) => {
    client.once('close', resolve);
    client.once('error', reject);
  });

  try {
    await client.connect();
    await (client as any).mailboxOpen('INBOX');
    console.log(`[idle] ${email}: watching INBOX`);
    // Initial sync on connect to catch messages arrived while offline
    await syncMailbox(mailboxId);
    await closePromise;
  } finally {
    if (debounce) clearTimeout(debounce);
    try { await (client as any).logout(); } catch { /* ignore */ }
  }
}

async function idleLoop(mailboxId: string): Promise<void> {
  let email = mailboxId;
  while (state.get(mailboxId)) {
    try {
      const mb = await prisma.mailboxes.findUnique({
        where: { id: mailboxId },
        include: { credentials: true },
      });
      if (!mb?.is_active || !mb.credentials || mb.sync_mode !== 'idle') {
        break;
      }
      email = mb.email_address;
      const pass = await decrypt(mb.credentials.encrypted_password);
      await connectAndWatch(mailboxId, email, {
        host: mb.credentials.imap_host,
        port: mb.credentials.imap_port,
        secure: mb.credentials.imap_secure,
        user: mb.credentials.username,
        pass,
      });
    } catch (e: any) {
      if (state.get(mailboxId)) {
        console.error(`[idle] ${email}: connection error, retry in 15s:`, e?.message || e);
        await sleep(15_000);
      }
    }
  }
  state.delete(mailboxId);
  console.log(`[idle] ${email}: stopped`);
}

export function startIdleForMailbox(mailboxId: string): void {
  if (state.has(mailboxId)) return;
  state.set(mailboxId, true);
  idleLoop(mailboxId).catch(e =>
    console.error(`[idle] ${mailboxId}: fatal:`, e?.message),
  );
}

export function stopIdleForMailbox(mailboxId: string): void {
  state.set(mailboxId, false);
}

export function getIdleMailboxIds(): string[] {
  return [...state.keys()];
}

// Start/stop IDLE connections based on current DB state.
// Safe to call repeatedly; idempotent for already-running mailboxes.
export async function reconcileIdleConnections(): Promise<void> {
  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true },
    select: { id: true, sync_mode: true },
  }).catch(() => [] as { id: string; sync_mode: string }[]);

  const idleIds = new Set(mailboxes.filter(m => m.sync_mode === 'idle').map(m => m.id));

  for (const id of state.keys()) {
    if (!idleIds.has(id)) stopIdleForMailbox(id);
  }
  for (const id of idleIds) {
    startIdleForMailbox(id);
  }
}
