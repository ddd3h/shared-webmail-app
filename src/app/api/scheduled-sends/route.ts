import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { APP_ROOT } from '@/lib/app-root';

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

  if (files.length > 0) {
    const storageDir = path.join(APP_ROOT, 'storage', 'attachments');
    await mkdir(storageDir, { recursive: true });
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
      const storageKey = path.join('storage', 'attachments', `${crypto.randomUUID()}${ext}`);
      await writeFile(path.join(APP_ROOT, storageKey), buffer);
      await prisma.scheduled_send_attachments.create({
        data: {
          scheduled_send_id: scheduled.id,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          size: file.size,
          storage_key: storageKey
        }
      });
    }
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
