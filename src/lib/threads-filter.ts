import { Prisma } from '@prisma/client';

export function parseQuery(raw: string) {
  const tokens = raw.trim().split(/\s+/);
  const filters = {
    from: [] as string[],
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
    subject: [] as string[],
    body: [] as string[],
    text: [] as string[],
    hasAttachment: false,
    after: null as Date | null,
    before: null as Date | null,
    mailbox: [] as string[],
    status: [] as string[],
    assigned: [] as string[],
  };

  const STATUS_MAP: Record<string, string> = {
    '未対応': 'open', 'open': 'open',
    '対応中': 'in_progress', 'in_progress': 'in_progress',
    '完了': 'done', 'done': 'done',
    '保留': 'waiting', 'waiting': 'waiting',
  };

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === 'has:attachment') { filters.hasAttachment = true; continue; }
    const colonIdx = tok.indexOf(':');
    if (colonIdx > 0) {
      const prefix = lower.slice(0, colonIdx);
      const val = tok.slice(colonIdx + 1);
      if (!val) continue;
      if (prefix === 'from') { filters.from.push(val); continue; }
      if (prefix === 'to') { filters.to.push(val); continue; }
      if (prefix === 'cc') { filters.cc.push(val); continue; }
      if (prefix === 'bcc') { filters.bcc.push(val); continue; }
      if (prefix === 'subject') { filters.subject.push(val); continue; }
      if (prefix === 'body') { filters.body.push(val); continue; }
      if (prefix === 'mailbox') { filters.mailbox.push(val); continue; }
      if (prefix === 'status') { const s = STATUS_MAP[val] || STATUS_MAP[val.toLowerCase()] || val; filters.status.push(s); continue; }
      if (prefix === 'assigned') { filters.assigned.push(val); continue; }
      if (prefix === 'after') { const d = new Date(val); if (!isNaN(d.getTime())) { filters.after = d; } continue; }
      if (prefix === 'before') { const d = new Date(val); if (!isNaN(d.getTime())) { filters.before = new Date(d.getTime() + 86400000); } continue; }
    }
    filters.text.push(tok);
  }
  return filters;
}

// The free words of a query (what the semantic search looks for); the rest (from:, status:, ...) still narrows the list as usual.
export function queryText(raw: string): string {
  return parseQuery(raw).text.join(' ');
}

export function queryWithoutText(raw: string): string {
  const f = parseQuery(raw);
  const free = new Set(f.text);
  return raw.trim().split(/\s+/).filter(tok => !free.has(tok)).join(' ');
}

// A word without upper and lower case (kanji, kana, digits) matches the same with LIKE as with ILIKE, and LIKE reads the mail bodies
// about 3 times faster: ILIKE folds the case of every body it reads (prod, 2026-11: 360 ms against 120 ms over ~9,000 mails).
const hasCase = (s: string) => s.toLowerCase() !== s.toUpperCase();
export const containsWord = (s: string): { contains: string; mode?: Prisma.QueryMode } => (hasCase(s) ? { contains: s, mode: 'insensitive' } : { contains: s });

export function buildThreadsWhere(params: {
  session: { userId: string },
  status?: string,
  type?: string,
  q?: string,
  mine?: boolean,
  unread?: boolean,
  sent?: boolean,
  assigned?: boolean,
  teamUnreadIds?: string[],
  spam?: boolean,
  // the 共有メール view: one mailbox only (a chip), or every mailbox except the ones the person left out
  mailboxId?: string,
  hiddenMailboxIds?: string[]
}): Prisma.threadsWhereInput {
  const { session, status, type, q, mine, unread, sent, assigned, teamUnreadIds, spam, mailboxId, hiddenMailboxIds } = params;

  let messageWhere: Prisma.messagesWhereInput | undefined;
  const threadSearchClauses: Prisma.threadsWhereInput[] = [];

  if (q) {
    const f = parseQuery(q);
    const andClauses: Prisma.messagesWhereInput[] = [];

    for (const term of f.text) {
      andClauses.push({
        OR: [
          { subject: containsWord(term) },
          { text_body: containsWord(term) },
          { from_name: containsWord(term) },
          { from_email: containsWord(term) },
          { to_raw: containsWord(term) },
          { cc_raw: containsWord(term) },
        ]
      });
    }

    for (const val of f.from) {
      andClauses.push({
        OR: [
          { from_name: containsWord(val) },
          { from_email: containsWord(val) },
        ]
      });
    }

    for (const val of f.to) {
      andClauses.push({ to_raw: containsWord(val) });
    }
    for (const val of f.cc) {
      andClauses.push({ cc_raw: containsWord(val) });
    }
    for (const val of f.bcc) {
      andClauses.push({ bcc_raw: containsWord(val) });
    }
    for (const val of f.subject) {
      andClauses.push({ subject: containsWord(val) });
    }
    for (const val of f.body) {
      andClauses.push({ text_body: containsWord(val) });
    }
    if (f.hasAttachment) andClauses.push({ has_attachments: true });
    if (f.after) andClauses.push({ sent_at: { gte: f.after } });
    if (f.before) andClauses.push({ sent_at: { lt: f.before } });

    if (andClauses.length > 0) {
      messageWhere = andClauses.length === 1 ? andClauses[0] : { AND: andClauses };
    }

    for (const val of f.mailbox) {
      threadSearchClauses.push({ mailbox: { is: { display_name: { contains: val, mode: 'insensitive' } } } });
    }
    for (const val of f.status) {
      threadSearchClauses.push({ status: val as any });
    }
    for (const val of f.assigned) {
      threadSearchClauses.push({ assigned_user: { is: { name: { contains: val, mode: 'insensitive' } } } });
    }
  }

  return {
    // spam filter: show only spam tab OR exclude spam from all other tabs
    is_spam: spam ? true : false,
    ...(status ? { status: status as any } : {}),
    ...(mine ? { assigned_user_id: session.userId, status: { in: ['open', 'in_progress', 'waiting'] } } : {}),
    ...(assigned ? { assigned_user_id: { not: null } } : {}),
    ...(unread && type === 'personal' ? { unread_count: { gt: 0 } } : {}),
    ...(unread && type === 'team'
      ? teamUnreadIds
        ? { id: { in: teamUnreadIds } }
        : { reads: { none: { user_id: session.userId } } }
      : {}),
    ...(sent
      ? { messages: { some: { direction: 'outgoing' } } }
      : messageWhere
        ? { messages: { some: messageWhere } }
        : {}),
    ...(threadSearchClauses.length > 0 ? { AND: threadSearchClauses } : {}),
    mailbox: {
      is: {
        ...(type ? { type: type as any } : {}),
        ...(mailboxId ? { id: mailboxId } : hiddenMailboxIds && hiddenMailboxIds.length > 0 ? { id: { notIn: hiddenMailboxIds } } : {}),
        OR: [
          { type: 'personal', owner_user_id: session.userId },
          { permissions: { some: { user_id: session.userId, can_view: true } } }
        ]
      }
    },
    visibility: {
      none: {
        user_id: session.userId,
        is_hidden: true
      }
    }
  };
}
