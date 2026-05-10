import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// GET /api/drafts?mailbox_id=&thread_id= - list accessible drafts
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const url = new URL(req.url);
  const mailboxId = url.searchParams.get('mailbox_id') || undefined;
  const threadId = url.searchParams.get('thread_id') || undefined;

  // Get mailboxes user has access to (for shared drafts)
  const accessibleMailboxIds = (await prisma.mailboxes.findMany({
    where: {
      OR: [
        { type: 'personal', owner_user_id: session.userId },
        { permissions: { some: { user_id: session.userId, can_view: true } } }
      ]
    },
    select: { id: true }
  })).map(m => m.id);

  const drafts = await prisma.drafts.findMany({
    where: {
      ...(threadId ? { thread_id: threadId } : {}),
      ...(mailboxId ? { mailbox_id: mailboxId } : {}),
      OR: [
        { user_id: session.userId }, // own drafts
        { is_shared: true, mailbox_id: { in: accessibleMailboxIds } } // shared team drafts
      ]
    },
    orderBy: { updated_at: 'desc' },
    include: {
      user: { select: { name: true, email: true } },
      mailbox: { select: { display_name: true, type: true } }
    }
  });

  return NextResponse.json({ drafts });
}

// POST /api/drafts - create new draft
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const body = await req.json().catch(() => ({}));
  const { mailbox_id, thread_id, to_raw, cc_raw, bcc_raw, subject, html_body, text_body, is_shared } = body;

  const draft = await prisma.drafts.create({
    data: {
      user_id: session.userId,
      mailbox_id: mailbox_id || null,
      thread_id: thread_id || null,
      to_raw: to_raw || null,
      cc_raw: cc_raw || null,
      bcc_raw: bcc_raw || null,
      subject: subject || null,
      html_body: html_body || null,
      text_body: text_body || null,
      is_shared: !!is_shared
    }
  });

  return NextResponse.json({ ok: true, id: draft.id });
}
