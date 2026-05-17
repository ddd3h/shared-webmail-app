// Inline mail sync - syncs INBOX and Sent folder for a given mailbox
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { findOrCreateThread } from '@/lib/threading';
import { sendWebPushToUser } from '@/lib/push';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

type ImapFlowMod = typeof import('imapflow');
type MailparserMod = typeof import('mailparser');

type MailboxForNotify = {
  type: string;
  owner_user_id: string | null;
  permissions: { user_id: string }[];
};

async function notifyNewMessage({
  mb,
  threadId,
  subject,
  fromEmail,
  fromName,
}: {
  mb: MailboxForNotify;
  threadId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
}) {
  let userIds: string[] = [];
  if (mb.type === 'team') {
    userIds = mb.permissions.map(p => p.user_id);
  } else {
    if (mb.owner_user_id) userIds = [mb.owner_user_id];
  }
  if (userIds.length === 0) return;

  const title = `新着メール: ${subject}`;
  const body = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const url = `/threads/${threadId}`;

  Promise.all(userIds.map(async (userId) => {
    try {
      await prisma.notification_events.create({
        data: { user_id: userId, thread_id: threadId, event_type: 'new_message', title, body, url, priority: 'high' }
      });
      await sendWebPushToUser(userId, { title, body, url, icon: '/icon-192.png' });
    } catch {
      // Do not block sync on notification failure
    }
  })).catch(() => {});
}

// Common Sent folder names used by various mail servers
const SENT_FOLDER_CANDIDATES = ['Sent', 'Sent Items', 'Sent Messages', 'INBOX.Sent', '送信済みメール', 'Sent Mail'];

async function findSentFolder(client: any): Promise<string | null> {
  try {
    const tree = await client.listTree();
    const flatten = (node: any): any[] => [node, ...(node.folders || []).flatMap(flatten)];
    const all: any[] = flatten(tree);
    // Prefer folders with \Sent special-use flag
    const byFlag = all.find((f: any) => f.specialUse === '\\Sent' || (Array.isArray(f.flags) && f.flags.includes('\\Sent')));
    if (byFlag) return byFlag.path;
    // Fall back to name matching
    for (const name of SENT_FOLDER_CANDIDATES) {
      const found = all.find((f: any) => f.path?.toLowerCase() === name.toLowerCase());
      if (found) return found.path;
    }
  } catch {
    // listTree not supported by all servers
  }
  // Last resort: try each name directly via status()
  for (const name of SENT_FOLDER_CANDIDATES) {
    try {
      await client.status(name, { messages: true });
      return name;
    } catch { /* not found */ }
  }
  return null;
}

async function syncFolder(
  client: any,
  mailboxId: string,
  folderName: string,
  lastSeenUid: number | undefined,
  direction: 'incoming' | 'outgoing',
  mb: MailboxForNotify,
  errors: string[],
  uidStateKey: 'last_seen_uid' | 'last_seen_sent_uid',
): Promise<number> {
  const lock = await client.getMailboxLock(folderName);
  let synced = 0;
  try {
    const folderStatus = await client.status(folderName, { uidNext: true });
    const serverUidNext = (folderStatus as any).uidNext as number | undefined;
    if (lastSeenUid && serverUidNext && lastSeenUid + 1 >= serverUidNext) {
      return 0; // nothing new
    }

    const range = lastSeenUid ? `${lastSeenUid + 1}:*` : '1:*';
    const fetcher = client.fetch(range as any, {
      envelope: true, source: true, uid: true, bodyStructure: true, flags: true, internalDate: true
    } as any, { uid: true } as any);

    for await (const msg of fetcher) {
      try {
        const uid = (msg as any).uid as number;
        const envelope = (msg as any).envelope;
        const mid = envelope?.messageId as string | undefined;
        const stripId = (s: string) => s.trim().replace(/^<|>$/g, '').trim();
        const inReplyTo = envelope?.inReplyTo ? stripId(envelope.inReplyTo as string) || null : null;
        const references = (Array.isArray(envelope?.references)
          ? (envelope!.references as string[])
          : typeof envelope?.references === 'string' ? [envelope.references] : []
        ).map(stripId).filter(Boolean);
        const subject = (envelope?.subject as string | undefined) || '';
        const from = envelope?.from?.[0];
        const fromEmail = (from as any)?.address || '';
        const fromName = (from as any)?.name || null;
        const date = (envelope?.date as Date | undefined) || new Date();

        let text: string | null = null;
        let html: string | null = null;
        let parsedAttachments: any[] = [];
        try {
          const { simpleParser } = (await import('mailparser')) as MailparserMod;
          const parsed = await simpleParser((msg as any).source as Buffer);
          text = parsed.text || null;
          html = parsed.html ? (typeof parsed.html === 'string' ? parsed.html : null) : null;
          parsedAttachments = parsed.attachments || [];
        } catch (parseErr) {
          errors.push(`Parse error for uid ${uid} in ${folderName}: ${parseErr}`);
        }

        const toList = (envelope?.to || []).map((a: any) => a.address).filter(Boolean);
        const ccList = (envelope?.cc || []).map((a: any) => a.address).filter(Boolean);
        const externalId = (mid ? mid.trim().replace(/^<|>$/g, '').trim() : '') || `uid:${mailboxId}:${folderName}:${uid}`;

        // Dedup: scoped to mailbox so CC'd emails get their own record per mailbox
        const exists = await prisma.messages.findFirst({
          where: { external_message_id: externalId, mailbox_id: mailboxId }
        });
        if (exists) {
          await prisma.mailbox_sync_states.update({
            where: { mailbox_id: mailboxId },
            data: { [uidStateKey]: String(uid) }
          });
          continue;
        }

        const threadId = await findOrCreateThread(mailboxId, {
          externalId, inReplyTo, references, subject, fromName, fromEmail,
          to: toList, cc: ccList, text, html, date,
          hasAttachments: parsedAttachments.length > 0
        });

        const created = await prisma.messages.create({
          data: {
            thread_id: threadId,
            mailbox_id: mailboxId,
            external_message_id: externalId,
            imap_uid: uid,
            in_reply_to: inReplyTo,
            references_raw: references.join(' ') || null,
            direction,
            from_name: fromName,
            from_email: fromEmail,
            to_raw: toList.join(', '),
            cc_raw: ccList.join(', ') || null,
            bcc_raw: null,
            subject,
            text_body: text,
            html_body: html,
            sent_at: date,
            received_at: direction === 'incoming' ? date : null,
            raw_headers: null,
            has_attachments: parsedAttachments.length > 0
          }
        });

        // Save attachments
        if (parsedAttachments.length > 0) {
          const baseDir = path.join(process.cwd(), 'storage', 'attachments');
          await mkdir(baseDir, { recursive: true });
          for (const a of parsedAttachments) {
            const attId = crypto.randomUUID();
            const filename = (a as any).filename || 'attachment';
            const contentType = (a as any).contentType || 'application/octet-stream';
            const buf: Buffer = (a as any).content as Buffer;
            const storageKey = `storage/attachments/${attId}`;
            await writeFile(path.join(process.cwd(), storageKey), buf);
            await prisma.attachments.create({
              data: { message_id: created.id, filename, content_type: contentType, size: buf.length, storage_key: storageKey }
            });
          }
        }

        // Update thread timestamps
        await prisma.threads.update({
          where: { id: threadId },
          data: {
            last_message_at: date,
            ...(direction === 'incoming'
              ? { last_received_at: date, unread_count: { increment: 1 } }
              : { last_sent_at: date })
          }
        });

        // Reset completed thread to open when new incoming message arrives
        if (direction === 'incoming') {
          await prisma.threads.updateMany({
            where: { id: threadId, status: 'done' },
            data: { status: 'open' }
          });
        }

        // Notify only for incoming messages
        if (direction === 'incoming') {
          await notifyNewMessage({ mb, threadId, subject, fromEmail, fromName });
        }

        await prisma.mailbox_sync_states.upsert({
          where: { mailbox_id: mailboxId },
          create: { mailbox_id: mailboxId, [uidStateKey]: String(uid), status: 'running', last_sync_started_at: new Date() },
          update: { [uidStateKey]: String(uid) }
        });

        synced++;
      } catch (msgErr) {
        errors.push(`Error processing message in ${folderName}: ${msgErr}`);
      }
    }
  } finally {
    lock.release();
  }
  return synced;
}

export async function syncMailbox(mailboxId: string): Promise<{ synced: number; errors: string[] }> {
  const mb = await prisma.mailboxes.findUnique({
    where: { id: mailboxId },
    include: {
      credentials: true,
      sync_state: true,
      permissions: { where: { can_view: true }, select: { user_id: true } }
    }
  });

  if (!mb || !mb.credentials) {
    return { synced: 0, errors: ['Mailbox or credentials not found'] };
  }

  const cred = mb.credentials;
  const errors: string[] = [];
  let synced = 0;

  const { ImapFlow } = (await import('imapflow')) as ImapFlowMod;
  const connectTimeout = parseInt(process.env.EMAIL_CONNECT_TIMEOUT_MS || '10000', 10);
  const client = new ImapFlow({
    host: cred.imap_host,
    port: cred.imap_port,
    secure: cred.imap_secure,
    auth: { user: cred.username, pass: await decrypt(cred.encrypted_password) },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectTimeout,
  } as any);

  try {
    await prisma.mailbox_sync_states.upsert({
      where: { mailbox_id: mailboxId },
      create: { mailbox_id: mailboxId, status: 'running', last_sync_started_at: new Date() },
      update: { status: 'running', last_sync_started_at: new Date() }
    });

    await client.connect();

    // Sync INBOX (incoming)
    const lastInboxUid = mb.sync_state?.last_seen_uid ? Number(mb.sync_state.last_seen_uid) : undefined;
    synced += await syncFolder(client, mailboxId, 'INBOX', lastInboxUid, 'incoming', mb, errors, 'last_seen_uid');

    // Sync Sent folder (outgoing) — find whichever folder name this server uses
    const sentFolder = await findSentFolder(client);
    if (sentFolder) {
      const lastSentUid = (mb.sync_state as any)?.last_seen_sent_uid
        ? Number((mb.sync_state as any).last_seen_sent_uid)
        : undefined;
      synced += await syncFolder(client, mailboxId, sentFolder, lastSentUid, 'outgoing', mb, errors, 'last_seen_sent_uid');
    } else {
      errors.push('Sent folder not found (tried: ' + SENT_FOLDER_CANDIDATES.join(', ') + ')');
    }

    await client.logout();

    await prisma.mailbox_sync_states.update({
      where: { mailbox_id: mailboxId },
      data: { last_sync_finished_at: new Date(), last_success_at: new Date(), status: 'idle', last_error: null }
    });

    return { synced, errors };
  } catch (e: any) {
    const errMsg = String(e?.message || e);
    errors.push(errMsg);
    try { await client.logout(); } catch {}
    await prisma.mailbox_sync_states.upsert({
      where: { mailbox_id: mailboxId },
      create: { mailbox_id: mailboxId, status: 'error', last_error: errMsg },
      update: { status: 'error', last_error: errMsg }
    });
    return { synced, errors };
  }
}
