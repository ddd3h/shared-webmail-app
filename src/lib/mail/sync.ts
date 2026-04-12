// Inline mail sync - syncs INBOX for a given mailbox
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
  // Determine which users to notify
  let userIds: string[] = [];

  if (mb.type === 'team') {
    // All users with can_view permission on the team mailbox
    userIds = mb.permissions.map(p => p.user_id);
  } else {
    // Personal mailbox: notify the owner
    if (mb.owner_user_id) userIds = [mb.owner_user_id];
  }

  if (userIds.length === 0) return;

  const title = `新着メール: ${subject}`;
  const body = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const url = `/threads/${threadId}`;

  // Create notification_events and send Web Push for each user (fire-and-forget)
  Promise.all(userIds.map(async (userId) => {
    try {
      await prisma.notification_events.create({
        data: {
          user_id: userId,
          thread_id: threadId,
          event_type: 'new_message',
          title,
          body,
          url,
          priority: 'high'
        }
      });
      await sendWebPushToUser(userId, { title, body, url, icon: '/icon-192.png' });
    } catch {
      // Do not block sync on notification failure
    }
  })).catch(() => {});
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
  const client = new ImapFlow({
    host: cred.imap_host,
    port: cred.imap_port,
    secure: cred.imap_secure,
    auth: { user: cred.username, pass: await decrypt(cred.encrypted_password) },
    logger: false,
    tls: { rejectUnauthorized: false }
  } as any);

  try {
    await prisma.mailbox_sync_states.upsert({
      where: { mailbox_id: mailboxId },
      create: { mailbox_id: mailboxId, status: 'running', last_sync_started_at: new Date() },
      update: { status: 'running', last_sync_started_at: new Date() }
    });

    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    try {
      const lastUid = mb.sync_state?.last_seen_uid ? Number(mb.sync_state.last_seen_uid) : undefined;
      const range = lastUid ? `${lastUid + 1}:*` : '1:*';

      // Check if there is anything new to fetch (avoid Command failed on empty UID range)
      const inboxStatus = await client.status('INBOX', { uidNext: true });
      const serverUidNext = (inboxStatus as any).uidNext as number | undefined;
      if (lastUid && serverUidNext && lastUid + 1 >= serverUidNext) {
        // Nothing new
        await prisma.mailbox_sync_states.update({
          where: { mailbox_id: mailboxId },
          data: { last_sync_finished_at: new Date(), last_success_at: new Date(), status: 'idle', last_error: null }
        });
        return { synced: 0, errors: [] };
      }

      // { uid: true } as third arg → range is treated as UID range, not sequence numbers
      const fetcher = client.fetch(range as any, {
        envelope: true,
        source: true,
        uid: true,
        bodyStructure: true,
        flags: true,
        internalDate: true
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
            : typeof envelope?.references === 'string'
            ? [envelope.references]
            : []
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
            errors.push(`Parse error for uid ${uid}: ${parseErr}`);
          }

          const toList = (envelope?.to || []).map((a: any) => a.address).filter(Boolean);
          const ccList = (envelope?.cc || []).map((a: any) => a.address).filter(Boolean);

          // Normalize message ID: strip angle brackets so "<id@host>" and "id@host" match
          const externalId = (mid ? mid.trim().replace(/^<|>$/g, '').trim() : '') || `uid:${mailboxId}:${uid}`;

          // Dedup check
          const exists = await prisma.messages.findFirst({
            where: { external_message_id: externalId }
          });
          if (exists) {
            // Update last seen UID even for existing messages
            await prisma.mailbox_sync_states.update({
              where: { mailbox_id: mailboxId },
              data: { last_seen_uid: String(uid) }
            });
            continue;
          }

          const threadId = await findOrCreateThread(mailboxId, {
            externalId,
            inReplyTo,
            references,
            subject,
            fromName,
            fromEmail,
            to: toList,
            cc: ccList,
            text,
            html,
            date,
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
              direction: 'incoming',
              from_name: fromName,
              from_email: fromEmail,
              to_raw: toList.join(', '),
              cc_raw: ccList.join(', ') || null,
              bcc_raw: null,
              subject,
              text_body: text,
              html_body: html,
              sent_at: date,
              received_at: date,
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
                data: {
                  message_id: created.id,
                  filename,
                  content_type: contentType,
                  size: buf.length,
                  storage_key: storageKey
                }
              });
            }
          }

          // Update thread timestamps
          await prisma.threads.update({
            where: { id: threadId },
            data: {
              last_message_at: date,
              last_received_at: date,
              unread_count: { increment: 1 }
            }
          });

          // Send notifications and Web Push
          await notifyNewMessage({
            mb,
            threadId,
            subject,
            fromEmail,
            fromName
          });

          // Update last seen UID
          await prisma.mailbox_sync_states.upsert({
            where: { mailbox_id: mailboxId },
            create: { mailbox_id: mailboxId, last_seen_uid: String(uid), status: 'running', last_sync_started_at: new Date() },
            update: { last_seen_uid: String(uid) }
          });

          synced++;
        } catch (msgErr) {
          errors.push(`Error processing message: ${msgErr}`);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    await prisma.mailbox_sync_states.update({
      where: { mailbox_id: mailboxId },
      data: {
        last_sync_finished_at: new Date(),
        last_success_at: new Date(),
        status: 'idle',
        last_error: null
      }
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
