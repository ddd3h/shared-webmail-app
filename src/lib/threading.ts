import { prisma } from '@/lib/db';
import { normalizeSubject } from '@/lib/subject';

export type ParsedMessage = {
  externalId: string;
  inReplyTo?: string | null;
  references?: string[];
  subject: string;
  fromName?: string | null;
  fromEmail: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  text?: string | null;
  html?: string | null;
  date: Date;
  hasAttachments: boolean;
};

/** Strip angle brackets from a message ID: "<id@host>" → "id@host" */
function normalizeMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.trim().replace(/^<|>$/g, '').trim() || null;
}

export async function findOrCreateThread(mailboxId: string, pm: ParsedMessage) {
  const norm = normalizeSubject(pm.subject || '');

  // 1) Try by in-reply-to / references (normalize angle brackets on both sides)
  const inReplyToNorm = normalizeMessageId(pm.inReplyTo);
  if (inReplyToNorm) {
    const refMsg = await prisma.messages.findFirst({
      where: {
        mailbox_id: mailboxId,
        external_message_id: { in: [inReplyToNorm, `<${inReplyToNorm}>`] }
      }
    });
    if (refMsg) return refMsg.thread_id;
  }

  if (pm.references && pm.references.length > 0) {
    const refIds = pm.references.flatMap(r => {
      const n = normalizeMessageId(r);
      return n ? [n, `<${n}>`] : [];
    });
    if (refIds.length > 0) {
      const refMsg = await prisma.messages.findFirst({
        where: { mailbox_id: mailboxId, external_message_id: { in: refIds } }
      });
      if (refMsg) return refMsg.thread_id;
    }
  }

  // 2) Fallback: match by normalized subject — extend window to 30 days
  const recent = await prisma.threads.findFirst({
    where: {
      mailbox_id: mailboxId,
      normalized_subject: norm,
      last_message_at: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) }
    },
    orderBy: { last_message_at: 'desc' }
  });
  if (recent) return recent.id;

  // 3) Create new thread
  const t = await prisma.threads.create({
    data: {
      mailbox_id: mailboxId,
      subject: pm.subject || '(no subject)'
        , normalized_subject: norm,
      status: 'open',
      assigned_user_id: null,
      last_message_at: pm.date,
      last_received_at: pm.date,
      last_sent_at: null,
      last_replied_by_user_id: null,
      unread_count: 1,
      is_archived: false
    }
  });
  return t.id;
}

