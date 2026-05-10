import { prisma } from './db';

export type ThreadMatchInput = {
  externalId: string;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  fromName: string | null;
  fromEmail: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  text: string | null;
  html: string | null;
  date: Date;
  hasAttachments: boolean;
};

// For backward compatibility or worker usage if it was named ParsedMessage
export type ParsedMessage = ThreadMatchInput;

/**
 * Find or create a thread for an incoming message.
 * Logic: Match by normalized subject and mailbox within a recent time window (e.g., 30 days)
 */
export async function findOrCreateThread(mailboxId: string, input: ThreadMatchInput): Promise<string> {
  const normalized = normalizeSubject(input.subject);
  const thirtyDaysAgo = new Date(input.date.getTime() - 30 * 24 * 3600 * 1000);

  // Look for existing thread
  const existing = await prisma.threads.findFirst({
    where: {
      mailbox_id: mailboxId,
      normalized_subject: normalized,
      last_message_at: { gte: thirtyDaysAgo }
    },
    orderBy: { last_message_at: 'desc' },
    select: { id: true }
  });

  if (existing) {
    // Update thread timestamp
    await prisma.threads.update({
      where: { id: existing.id },
      data: {
        last_message_at: input.date,
        updated_at: new Date()
      }
    });
    return existing.id;
  }

  // Create new thread
  const t = await prisma.threads.create({
    data: {
      mailbox_id: mailboxId,
      subject: input.subject,
      normalized_subject: normalized,
      status: 'open',
      last_message_at: input.date,
      last_received_at: input.date,
      last_replied_by_user_id: null,
      unread_count: 1
    }
  });
  return t.id;
}

function normalizeSubject(s: string): string {
  return s
    .replace(/^(re|fwd|fw|aw|答|転送):\s*/i, '')
    .trim()
    .toLowerCase();
}
