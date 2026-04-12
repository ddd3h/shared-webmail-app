// 同期 Worker 実装（INBOX の簡易同期）
import { queues } from '@/lib/queue';
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { findOrCreateThread, ParsedMessage } from '@/lib/threading';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

type ImapFlowMod = typeof import('imapflow');
type MailparserMod = typeof import('mailparser');

async function main() {
  queues.syncMailbox.process?.(async (job) => {
    const mailboxId = job.data.mailboxId;
    const mb = await prisma.mailboxes.findUnique({ where: { id: mailboxId }, include: { credentials: true, sync_state: true } });
    if (!mb || !mb.credentials) return;
    const cred = mb.credentials;
    const { ImapFlow } = (await import('imapflow')) as ImapFlowMod as any;
    const client = new ImapFlow({
      host: cred.imap_host,
      port: cred.imap_port,
      secure: cred.imap_secure,
      auth: { user: cred.username, pass: await decrypt(cred.encrypted_password) },
      logger: false
    } as any);
    try {
      await client.connect();
      await prisma.mailbox_sync_states.upsert({
        where: { mailbox_id: mailboxId },
        create: { mailbox_id: mailboxId, status: 'running', last_sync_started_at: new Date() },
        update: { status: 'running', last_sync_started_at: new Date() }
      });
      const lock = await client.getMailboxLock('INBOX');
      try {
        const lastUid = mb.sync_state?.last_seen_uid ? Number(mb.sync_state.last_seen_uid) : undefined;
        const range = lastUid ? `${lastUid + 1}:*` : '1:*';
        const fetcher = client.fetch(range, { envelope: true, source: true, uid: true, headers: true, bodyStructure: true, flags: true, internalDate: true });
        for await (const msg of fetcher) {
          const uid = msg.uid as number;
          const mid = msg.envelope?.messageId as string | undefined;
          const inReplyTo = (msg.envelope?.inReplyTo as string | undefined) ?? null;
          const references = Array.isArray(msg.envelope?.references) ? (msg.envelope!.references as string[]) : [];
          const subject = (msg.envelope?.subject as string | undefined) || '';
          const from = msg.envelope?.from?.[0];
          const fromEmail = from?.address || '';
          const fromName = from?.name || null;
          const date = (msg.envelope?.date as Date | undefined) || new Date();
          let text: string | null = null;
          let html: string | null = null;

          // Parse body using mailparser
          let parsed: any = null;
          try {
            const { simpleParser } = (await import('mailparser')) as MailparserMod as any;
            parsed = await simpleParser(msg.source as Buffer);
            text = parsed.text || null;
            html = parsed.html ? (typeof parsed.html === 'string' ? parsed.html : null) : null;
          } catch {}

          const pm: ParsedMessage = {
            externalId: mid || `uid:${uid}`,
            inReplyTo,
            references,
            subject,
            fromName,
            fromEmail,
            to: (msg.envelope?.to || []).map((a: any) => a.address),
            cc: (msg.envelope?.cc || []).map((a: any) => a.address),
            bcc: [],
            text,
            html,
            date,
            hasAttachments: !!msg.bodyStructure?.childNodes?.some((n: any) => n.disposition?.type?.toLowerCase() === 'attachment')
          };

          const threadId = await findOrCreateThread(mailboxId, pm);
          // Dedup by external_message_id
          const exists = await prisma.messages.findFirst({ where: { mailbox_id: mailboxId, external_message_id: pm.externalId } });
          if (!exists) {
            const created = await prisma.messages.create({
              data: {
                thread_id: threadId,
                mailbox_id: mailboxId,
                external_message_id: pm.externalId,
                in_reply_to: pm.inReplyTo ?? null,
                references_raw: pm.references?.join(' ') || null,
                direction: 'incoming',
                from_name: pm.fromName,
                from_email: pm.fromEmail,
                to_raw: pm.to.join(', '),
                cc_raw: pm.cc?.join(', ') || null,
                bcc_raw: null,
                subject: pm.subject,
                text_body: pm.text,
                html_body: pm.html,
                sent_at: pm.date,
                received_at: date,
                raw_headers: null,
                has_attachments: pm.hasAttachments
              }
            });
            // Save attachments (local fs) if present
            if (parsed?.attachments?.length) {
              const baseDir = path.join(process.cwd(), 'storage', 'attachments');
              await mkdir(baseDir, { recursive: true });
              for (const a of parsed.attachments) {
                const attId = crypto.randomUUID();
                const filename = a.filename || 'attachment';
                const contentType = a.contentType || 'application/octet-stream';
                const buf: Buffer = a.content as Buffer;
                const storageKey = path.join('storage', 'attachments', `${attId}`);
                await writeFile(path.join(process.cwd(), storageKey), buf);
                await prisma.attachments.create({
                  data: { message_id: created.id, filename, content_type: contentType, size: buf.length, storage_key: storageKey }
                });
              }
            }
            await prisma.threads.update({ where: { id: threadId }, data: { last_message_at: pm.date, last_received_at: pm.date, unread_count: { increment: 1 } } });
            // Notify assigned user on team mailbox
            if (mb.type === 'team') {
              const thread = await prisma.threads.findUnique({ where: { id: threadId } });
              if (thread?.assigned_user_id) {
                await prisma.notification_events.create({ data: { user_id: thread.assigned_user_id, thread_id: threadId, event_type: 'thread_updated', title: `新着: ${pm.subject}`, body: `${pm.fromEmail}`, url: `/threads/${threadId}`, priority: 'high' } });
              }
            }
          }

          // Update last seen UID progressively
          await prisma.mailbox_sync_states.upsert({
            where: { mailbox_id: mailboxId },
            create: { mailbox_id: mailboxId, last_seen_uid: String(uid), status: 'running', last_sync_started_at: new Date() },
            update: { last_seen_uid: String(uid) }
          });
        }
      } finally {
        lock.release();
      }
      await client.logout();
      await prisma.mailbox_sync_states.update({ where: { mailbox_id: mailboxId }, data: { last_sync_finished_at: new Date(), last_success_at: new Date(), status: 'idle' } });
      console.log('[sync] success', mailboxId);
    } catch (e: any) {
      console.error('[sync] failed', mailboxId, e?.message || e);
      try { await client.logout(); } catch {}
      await prisma.mailbox_sync_states.upsert({ where: { mailbox_id: mailboxId }, create: { mailbox_id: mailboxId, status: 'error', last_error: String(e?.message || e) }, update: { status: 'error', last_error: String(e?.message || e) } });
    }
  });
  console.log('Sync worker started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
