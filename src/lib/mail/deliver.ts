// Shared message-creation logic used by the compose route, the reply route,
// and the scheduled-send cron dispatcher. Callers are responsible for auth
// checks and for persisting any uploaded files to disk before calling in.
import { prisma } from '@/lib/db';
import { sanitizeEmailHtml } from '@/lib/sanitize';
import { logAudit } from '@/lib/audit';
import { sendMailForMessage } from '@/lib/mail/send-job';

export type DeliverAttachment = {
  filename: string;
  content_type: string;
  size: number;
  storage_key: string;
};

export type DeliverComposeParams = {
  mailboxId: string;
  userId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  attachments?: DeliverAttachment[];
  auditActionType?: string;
};

export type DeliverReplyParams = {
  origMessageId: string;
  fromMailboxId?: string;
  userId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  attachments?: DeliverAttachment[];
  auditActionType?: string;
};

export type DeliverResult = { threadId: string; messageId: string };

// Dispatches every scheduled_sends row whose scheduled_at has arrived: creates the
// real message (compose or reply) and sends it. Called both from the in-process
// timer (instrumentation.node.ts, the app's actual dispatch path — mirrors how IMAP
// sync/MFI jobs run) and from /api/cron/scheduled-send (kept for external cron /
// Vercel deployments that don't run the long-lived Node process).
export async function dispatchDueScheduledSends() {
  const due = await prisma.scheduled_sends.findMany({
    where: { status: 'pending', scheduled_at: { lte: new Date() } },
    include: { attachments: true },
    orderBy: { scheduled_at: 'asc' }
  });

  const results: { id: string; status: 'ok' | 'error'; message_id?: string; error?: string }[] = [];
  for (const s of due) {
    try {
      const to = s.to_raw.split(/,\s*/).map(v => v.trim()).filter(Boolean);
      const cc = s.cc_raw ? s.cc_raw.split(/,\s*/).map(v => v.trim()).filter(Boolean) : undefined;
      const bcc = s.bcc_raw ? s.bcc_raw.split(/,\s*/).map(v => v.trim()).filter(Boolean) : undefined;
      const attachments: DeliverAttachment[] = s.attachments.map(a => ({
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
        storage_key: a.storage_key
      }));

      const { messageId } = s.mode === 'reply'
        ? await deliverReply({
            origMessageId: s.reply_to_message_id!,
            fromMailboxId: s.mailbox_id,
            userId: s.user_id,
            to, cc, bcc,
            subject: s.subject,
            text: s.text_body,
            html: s.html_body,
            attachments,
            auditActionType: 'scheduled_reply_sent'
          })
        : await deliverCompose({
            mailboxId: s.mailbox_id,
            userId: s.user_id,
            to, cc, bcc,
            subject: s.subject,
            text: s.text_body,
            html: s.html_body,
            attachments,
            auditActionType: 'scheduled_compose_sent'
          });

      await sendMailForMessage(messageId);

      await prisma.scheduled_sends.update({
        where: { id: s.id },
        data: { status: 'success', sent_message_id: messageId, error_message: null }
      });
      results.push({ id: s.id, status: 'ok', message_id: messageId });
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      console.error('[scheduled-send] dispatch failed', s.id, errMsg);
      await prisma.scheduled_sends.update({
        where: { id: s.id },
        data: { status: 'failed', error_message: errMsg }
      }).catch(() => {});
      results.push({ id: s.id, status: 'error', error: errMsg });
    }
  }

  return { dispatched: due.length, results };
}

async function createAttachments(messageId: string, attachments?: DeliverAttachment[]) {
  if (!attachments?.length) return;
  await prisma.attachments.createMany({
    data: attachments.map(a => ({
      message_id: messageId,
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
      storage_key: a.storage_key,
    })),
  });
}

// Creates a brand-new thread + outgoing message (used for both "compose" and
// "forward", which are functionally identical: a new thread with a fully
// pre-composed body).
export async function deliverCompose(params: DeliverComposeParams): Promise<DeliverResult> {
  const mailbox = await prisma.mailboxes.findUnique({ where: { id: params.mailboxId } });
  if (!mailbox) throw new Error('mailbox_not_found');

  const { normalizeSubject } = await import('@/lib/subject');
  const thread = await prisma.threads.create({
    data: {
      mailbox_id: params.mailboxId,
      subject: params.subject,
      normalized_subject: normalizeSubject(params.subject),
      status: 'open',
      unread_count: 0,
      last_message_at: new Date(),
      assigned_user_id: null,
    },
  });

  const msg = await prisma.messages.create({
    data: {
      thread_id: thread.id,
      mailbox_id: params.mailboxId,
      external_message_id: `local:${crypto.randomUUID()}`,
      direction: 'outgoing',
      from_name: mailbox.sender_name || mailbox.display_name,
      from_email: mailbox.email_address,
      to_raw: params.to.join(', '),
      cc_raw: params.cc?.join(', ') || null,
      bcc_raw: params.bcc?.join(', ') || null,
      subject: params.subject,
      text_body: params.text || null,
      html_body: params.html ? sanitizeEmailHtml(params.html) : null,
      sent_at: new Date(),
      received_at: null,
      raw_headers: null,
      has_attachments: (params.attachments?.length ?? 0) > 0,
    },
  });

  await createAttachments(msg.id, params.attachments);

  await prisma.message_sends.create({
    data: {
      message_id: msg.id,
      thread_id: thread.id,
      mailbox_id: params.mailboxId,
      sent_by_user_id: params.userId,
      status: 'pending',
      sent_at: new Date(),
    },
  });

  await logAudit({
    actorUserId: params.userId,
    actionType: params.auditActionType || 'compose_sent',
    targetType: 'threads',
    targetId: thread.id,
    metadata: { to: params.to, subject: params.subject },
  });

  return { threadId: thread.id, messageId: msg.id };
}

// Creates an outgoing message replying within an existing thread.
export async function deliverReply(params: DeliverReplyParams): Promise<DeliverResult> {
  const orig = await prisma.messages.findUnique({
    where: { id: params.origMessageId },
    include: { thread: true, mailbox: true },
  });
  if (!orig) throw new Error('orig_not_found');

  let sendingMailbox = orig.mailbox;
  if (params.fromMailboxId && params.fromMailboxId !== orig.mailbox_id) {
    const mb = await prisma.mailboxes.findUnique({ where: { id: params.fromMailboxId } });
    if (mb) sendingMailbox = { ...orig.mailbox, ...mb };
  }

  const replySubject = params.subject ?? (orig.subject?.startsWith('Re:') ? orig.subject : `Re: ${orig.subject}`);
  const inReplyTo = orig.external_message_id || undefined;
  const references = [orig.references_raw, orig.external_message_id].filter(Boolean).join(' ').trim();

  const toList = params.to ?? (
    orig.direction === 'incoming'
      ? (orig.from_email ? [orig.from_email] : [])
      : (orig.to_raw?.split(/,\s*/).map(s => s.trim()).filter(Boolean) ?? [])
  );
  if (toList.length === 0) throw new Error('no_recipient');

  const msg = await prisma.messages.create({
    data: {
      thread_id: orig.thread_id,
      mailbox_id: sendingMailbox.id,
      external_message_id: `local:${crypto.randomUUID()}`,
      in_reply_to: inReplyTo || null,
      references_raw: references || null,
      direction: 'outgoing',
      from_name: sendingMailbox.sender_name || sendingMailbox.display_name,
      from_email: sendingMailbox.email_address,
      to_raw: toList.join(', '),
      cc_raw: params.cc?.join(', ') || null,
      bcc_raw: params.bcc?.join(', ') || null,
      subject: replySubject,
      text_body: params.text || null,
      html_body: params.html ? sanitizeEmailHtml(params.html) : null,
      sent_at: new Date(),
      received_at: null,
      raw_headers: null,
      has_attachments: (params.attachments?.length ?? 0) > 0,
    },
  });

  await createAttachments(msg.id, params.attachments);

  await prisma.message_sends.create({
    data: {
      message_id: msg.id,
      thread_id: msg.thread_id,
      mailbox_id: msg.mailbox_id,
      sent_by_user_id: params.userId,
      smtp_response: null,
      status: 'pending',
      error_message: null,
      sent_at: new Date(),
    },
  });

  await prisma.threads.update({
    where: { id: orig.thread_id },
    data: {
      last_sent_at: new Date(),
      last_message_at: new Date(),
      last_replied_by_user_id: params.userId,
    },
  });

  await logAudit({
    actorUserId: params.userId,
    actionType: params.auditActionType || 'reply_enqueued',
    targetType: 'threads',
    targetId: orig.thread_id,
    metadata: { message_id: msg.id },
  });

  return { threadId: msg.thread_id, messageId: msg.id };
}
