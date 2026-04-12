import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { sendMailForMessage } from '@/lib/mail/send-job';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// POST /api/messages/compose - send a brand-new email (not a reply)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const contentType = req.headers.get('content-type') || '';
  let mailbox_id: string, to: string[], cc: string[] | undefined, subject: string,
    text: string | undefined, html: string | undefined, files: File[] = [];

  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData();
    mailbox_id = fd.get('mailbox_id') as string;
    to = JSON.parse((fd.get('to') as string) || '[]');
    cc = fd.has('cc') ? JSON.parse(fd.get('cc') as string) : undefined;
    subject = fd.get('subject') as string;
    text = (fd.get('text') as string) || undefined;
    html = (fd.get('html') as string) || undefined;
    files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
  } else {
    const body = await req.json().catch(() => ({}));
    ({ mailbox_id, subject } = body);
    to = body.to || [];
    cc = body.cc;
    text = body.text;
    html = body.html;
  }

  if (!mailbox_id || !subject || !to?.length) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const mailbox = await prisma.mailboxes.findUnique({
    where: { id: mailbox_id },
    include: { credentials: true }
  });
  if (!mailbox) return NextResponse.json({ error: 'mailbox_not_found' }, { status: 404 });
  if (!(await canReplyMailbox(session!.userId, mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { normalizeSubject } = await import('@/lib/subject');
  const thread = await prisma.threads.create({
    data: {
      mailbox_id,
      subject,
      normalized_subject: normalizeSubject(subject),
      status: 'open',
      unread_count: 0,
      last_message_at: new Date(),
      assigned_user_id: null
    }
  });

  const msg = await prisma.messages.create({
    data: {
      thread_id: thread.id,
      mailbox_id,
      external_message_id: `local:${crypto.randomUUID()}`,
      direction: 'outgoing',
      from_name: mailbox.display_name,
      from_email: mailbox.email_address,
      to_raw: to.join(', '),
      cc_raw: cc?.join(', ') || null,
      subject,
      text_body: text || null,
      html_body: html || null,
      sent_at: new Date(),
      received_at: null,
      raw_headers: null,
      has_attachments: files.length > 0
    }
  });

  // Save uploaded attachments
  if (files.length > 0) {
    const storageDir = path.join(process.cwd(), 'storage', 'attachments');
    await mkdir(storageDir, { recursive: true });
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
      const storageKey = path.join('storage', 'attachments', `${crypto.randomUUID()}${ext}`);
      await writeFile(path.join(process.cwd(), storageKey), buffer);
      await prisma.attachments.create({
        data: {
          message_id: msg.id,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          size: file.size,
          storage_key: storageKey
        }
      });
    }
  }

  await prisma.message_sends.create({
    data: {
      message_id: msg.id,
      thread_id: thread.id,
      mailbox_id,
      sent_by_user_id: session!.userId,
      status: 'pending',
      sent_at: new Date()
    }
  });

  await logAudit({
    actorUserId: session!.userId,
    actionType: 'compose_sent',
    targetType: 'threads',
    targetId: thread.id,
    metadata: { to, subject }
  });

  sendMailForMessage(msg.id).catch((e) => {
    console.error('[compose] sendMailForMessage failed', msg.id, e?.message || e);
  });

  return NextResponse.json({ ok: true, thread_id: thread.id, message_id: msg.id });
}
