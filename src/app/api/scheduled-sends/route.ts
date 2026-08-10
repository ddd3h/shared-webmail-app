import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { saveUploadedFiles } from '@/lib/attachment-storage';
import { resolveDraftAttachments, DraftAttachmentAccessError } from '@/lib/draft-access';
import type { DeliverAttachment } from '@/lib/mail/deliver';

type Mode = 'compose' | 'reply' | 'forward';

// POST /api/scheduled-sends - schedule an email to be sent at a future time.
// Nothing is written to `messages`/`threads` yet — that only happens once the
// cron dispatcher (/api/cron/scheduled-send) picks this up at scheduled_at,
// so a pending scheduled reply never shows up as "already sent" to teammates.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const contentType = req.headers.get('content-type') || '';
  let mode: Mode, mailboxId: string, replyToMessageId: string | undefined,
    to: string[], cc: string[] | undefined, bcc: string[] | undefined,
    subject: string | undefined, text: string | undefined, html: string | undefined,
    scheduledAt: string, files: File[] = [];
  let draftAttachmentIds: string[] = [];

  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData();
    mode = (fd.get('mode') as Mode) || 'compose';
    mailboxId = fd.get('mailboxId') as string;
    replyToMessageId = (fd.get('replyToMessageId') as string) || undefined;
    to = fd.has('to') ? JSON.parse(fd.get('to') as string) : [];
    cc = fd.has('cc') ? JSON.parse(fd.get('cc') as string) : undefined;
    bcc = fd.has('bcc') ? JSON.parse(fd.get('bcc') as string) : undefined;
    subject = (fd.get('subject') as string) || undefined;
    text = (fd.get('text') as string) || undefined;
    html = (fd.get('html') as string) || undefined;
    scheduledAt = fd.get('scheduledAt') as string;
    files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
    draftAttachmentIds = fd.getAll('draft_attachment_id').map(String).filter(Boolean);
  } else {
    const body = await req.json().catch(() => ({}));
    mode = body.mode || 'compose';
    mailboxId = body.mailboxId;
    replyToMessageId = body.replyToMessageId;
    to = body.to || [];
    cc = body.cc;
    bcc = body.bcc;
    subject = body.subject;
    text = body.text;
    html = body.html;
    scheduledAt = body.scheduledAt;
  }

  if (!mailboxId || !to?.length) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  if (mode === 'reply' && !replyToMessageId) {
    return NextResponse.json({ error: 'missing_reply_to' }, { status: 400 });
  }
  if (mode !== 'reply' && !subject?.trim()) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const when = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'invalid_scheduled_at' }, { status: 400 });
  }

  if (!(await canReplyMailbox(session!.userId, mailboxId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let threadId: string | undefined;
  let resolvedSubject = subject?.trim();
  if (mode === 'reply') {
    const orig = await prisma.messages.findUnique({ where: { id: replyToMessageId } });
    if (!orig) return NextResponse.json({ error: 'reply_target_not_found' }, { status: 404 });
    if (!(await canReplyMailbox(session!.userId, orig.mailbox_id))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    threadId = orig.thread_id;
    if (!resolvedSubject) {
      resolvedSubject = orig.subject?.startsWith('Re:') ? orig.subject : `Re: ${orig.subject}`;
    }
  }

  // Resolved before the row is created so an unauthorized draft attachment id
  // fails the request outright instead of leaving a half-built scheduled send.
  let attachments: DeliverAttachment[];
  try {
    attachments = [
      ...(await saveUploadedFiles(files)),
      ...(await resolveDraftAttachments(draftAttachmentIds, session!.userId)),
    ];
  } catch (e) {
    if (e instanceof DraftAttachmentAccessError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    throw e;
  }

  const scheduled = await prisma.scheduled_sends.create({
    data: {
      user_id: session!.userId,
      mailbox_id: mailboxId,
      mode,
      thread_id: threadId || null,
      reply_to_message_id: mode === 'reply' ? replyToMessageId : null,
      to_raw: to.join(', '),
      cc_raw: cc?.join(', ') || null,
      bcc_raw: bcc?.join(', ') || null,
      subject: resolvedSubject!,
      text_body: text || null,
      html_body: html || null,
      scheduled_at: when,
      status: 'pending',
    }
  });

  if (attachments.length > 0) {
    await prisma.scheduled_send_attachments.createMany({
      data: attachments.map(a => ({
        scheduled_send_id: scheduled.id,
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
        storage_key: a.storage_key
      }))
    });
  }

  return NextResponse.json({ ok: true, id: scheduled.id });
}

// GET /api/scheduled-sends - list the current user's pending scheduled sends
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const items = await prisma.scheduled_sends.findMany({
    where: { user_id: session!.userId, status: 'pending' },
    orderBy: { scheduled_at: 'asc' },
    include: { mailbox: { select: { display_name: true, email_address: true } } }
  });

  return NextResponse.json({
    items: items.map(s => ({
      id: s.id,
      mode: s.mode,
      mailbox: s.mailbox,
      to: s.to_raw,
      subject: s.subject,
      scheduled_at: s.scheduled_at,
      created_at: s.created_at,
    }))
  });
}
