/**
 * fix-missing-messages.mjs
 *
 * Production data-fix script.
 *
 * What it does:
 *   1. For every active mailbox, connects to IMAP and lists all message UIDs
 *      in INBOX (and Sent folder if present).
 *   2. Compares against messages already stored in the DB for that mailbox.
 *   3. If any INBOX messages are missing, resets last_seen_uid to
 *      (min_missing_uid - 1) so the next sync run will re-fetch them.
 *   4. Resets last_seen_sent_uid = NULL for every mailbox so the Sent folder
 *      is imported from scratch on the next sync run.
 *
 * Usage (run from the project root):
 *   node --env-file=.env scripts/fix-missing-messages.mjs
 *
 * The script is read-only on IMAP and only writes to mailbox_sync_states.
 * It is safe to run multiple times (idempotent).
 *
 * After running, trigger a sync for all mailboxes:
 *   curl http://localhost:3000/api/cron/sync
 *   (or however your production cron is set up)
 */

import { webcrypto } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ImapFlow } from 'imapflow';

const prisma = new PrismaClient();

// ─── Decrypt helper (mirrors src/lib/crypto.ts) ────────────────────────────
async function decrypt(b64) {
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 12);
  const data = raw.subarray(12);
  const keyBytes = Buffer.from(process.env.ENCRYPTION_KEY_HEX, 'hex');
  const key = await webcrypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(pt);
}

// ─── Sent folder detection (mirrors src/lib/mail/sync.ts) ──────────────────
const SENT_FOLDER_CANDIDATES = [
  'Sent', 'Sent Items', 'Sent Messages', 'INBOX.Sent', '送信済みメール', 'Sent Mail',
];

async function findSentFolder(client) {
  try {
    const tree = await client.listTree();
    const flatten = (node) => [node, ...(node.folders || []).flatMap(flatten)];
    const all = flatten(tree);
    const byFlag = all.find(
      f => f.specialUse === '\\Sent' || (Array.isArray(f.flags) && f.flags.includes('\\Sent'))
    );
    if (byFlag) return byFlag.path;
    for (const name of SENT_FOLDER_CANDIDATES) {
      const found = all.find(f => f.path?.toLowerCase() === name.toLowerCase());
      if (found) return found.path;
    }
  } catch { /* listTree not supported */ }
  for (const name of SENT_FOLDER_CANDIDATES) {
    try { await client.status(name, { messages: true }); return name; } catch { /* not found */ }
  }
  return null;
}

// ─── Get all UIDs in a folder (returns [] for empty folders) ───────────────
async function getUidsInFolder(client, folder) {
  const lock = await client.getMailboxLock(folder);
  try {
    const st = await client.status(folder, { messages: true });
    if (!st.messages || st.messages === 0) return [];
    const uids = [];
    const fetcher = client.fetch('1:*', { uid: true, envelope: true });
    for await (const msg of fetcher) {
      const mid = msg.envelope?.messageId?.trim().replace(/^<|>$/g, '') || '';
      uids.push({ uid: msg.uid, messageId: mid });
    }
    return uids;
  } finally {
    lock.release();
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
const mailboxes = await prisma.mailboxes.findMany({
  where: { is_active: true },
  include: { credentials: true, sync_state: true },
});

console.log(`Found ${mailboxes.length} active mailbox(es)\n`);

for (const mb of mailboxes) {
  console.log(`=== ${mb.email_address} ===`);

  if (!mb.credentials) {
    console.log('  [SKIP] No credentials\n');
    continue;
  }

  let client;
  try {
    const pass = await decrypt(mb.credentials.encrypted_password);
    client = new ImapFlow({
      host: mb.credentials.imap_host,
      port: mb.credentials.imap_port,
      secure: mb.credentials.imap_secure,
      auth: { user: mb.credentials.username, pass },
      logger: false,
      tls: { rejectUnauthorized: false },
      connectTimeout: 15000,
    });
    await client.connect();
  } catch (err) {
    console.log(`  [ERROR] IMAP connect failed: ${err.message}\n`);
    continue;
  }

  try {
    // ── 1. INBOX: find missing messages ──────────────────────────────────
    let inboxUids = [];
    try {
      inboxUids = await getUidsInFolder(client, 'INBOX');
    } catch (err) {
      console.log(`  [ERROR] INBOX fetch failed: ${err.message}`);
    }

    console.log(`  INBOX: ${inboxUids.length} messages on server`);

    if (inboxUids.length > 0) {
      // Get all message IDs already in DB for this mailbox
      const dbMids = new Set(
        (await prisma.messages.findMany({
          where: { mailbox_id: mb.id },
          select: { external_message_id: true, imap_uid: true },
        })).map(m => m.external_message_id)
      );

      const missing = inboxUids.filter(
        ({ messageId, uid }) => messageId && !dbMids.has(messageId)
      );

      if (missing.length === 0) {
        console.log('  INBOX: no missing messages — OK');
      } else {
        const minMissingUid = Math.min(...missing.map(m => m.uid));
        const resetUid = minMissingUid - 1;

        console.log(`  INBOX: ${missing.length} missing message(s), min uid=${minMissingUid}`);
        console.log(`  → resetting last_seen_uid to ${resetUid}`);

        await prisma.mailbox_sync_states.upsert({
          where: { mailbox_id: mb.id },
          create: { mailbox_id: mb.id, last_seen_uid: String(resetUid), status: 'idle' },
          update: { last_seen_uid: String(resetUid) },
        });
      }
    }

    // ── 2. Sent folder: reset so it is imported from scratch ─────────────
    const sentFolder = await findSentFolder(client);
    if (sentFolder) {
      console.log(`  Sent folder: "${sentFolder}" — resetting last_seen_sent_uid to NULL`);
    } else {
      console.log('  Sent folder: not found (will be skipped on next sync)');
    }

    await prisma.mailbox_sync_states.upsert({
      where: { mailbox_id: mb.id },
      create: { mailbox_id: mb.id, last_seen_sent_uid: null, status: 'idle' },
      update: { last_seen_sent_uid: null },
    });

  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  console.log();
}

await prisma.$disconnect();

console.log('Done. Run the sync endpoint to import missing messages:');
console.log('  curl http://localhost:3000/api/cron/sync');
console.log('  (repeat a few times if there are many messages)');
