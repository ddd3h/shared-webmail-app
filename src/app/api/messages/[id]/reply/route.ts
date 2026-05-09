import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { sendMailForMessage } from '@/lib/mail/send-job';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const contentType = req.headers.get('content-type') || '';
  let to: string[] | undefined, cc: string[] | undefined, bcc: string[] | undefined,
    subject: string | undefined, text: string | undefined, html: string | undefined,
    files: File[] = [], fromMailboxId: string | undefined;

  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData();
    fromMailboxId = (fd.get('fromMailboxId') as string) || undefined;
    to = fd.has('to') ? JSON.parse(fd.get('to') as string) : undefined;
    cc = fd.has('cc') ? JSON.parse(fd.get('cc') as string) : undefined;
    bcc = fd.has('bcc') ? JSON.parse(fd.get('bcc') as string) : undefined;
    subject = (fd.get('subject') as string) || undefined;
    text = (fd.get('text') as string) || undefined;
    html = (fd.get('html') as string) || undefined;
    files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
  } else {
    const body = await req.json().catch(() => ({}));
    ({ to, cc, bcc, subject, text, html, fromMailboxId } = body);
  }

  const orig = await prisma.messages.findUnique({
    where: { id },
    include: { thread: true, mailbox: { include: { credentials: true } } }
  });
  if (!orig) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canReplyMailbox(session!.userId, orig.mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Resolve the sending mailbox (may differ from the thread's mailbox when user selects a different From)
  let sendingMailbox = orig.mailbox;
  if (fromMailboxId && fromMailboxId !== orig.mailbox_id) {
    if (!(await canReplyMailbox(session!.userId, fromMailboxId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const mb = await prisma.mailboxes.findUnique({ where: { id: fromMailboxId } });
    if (mb) sendingMailbox = { ...orig.mailbox, ...mb };
  }

  const replySubject = subject ?? (orig.subject?.startsWith('Re:') ? orig.subject : `Re: ${orig.subject}`);
  const inReplyTo = orig.external_message_id || undefined;
  const references = [orig.references_raw, orig.external_message_id].filter(Boolean).join(' ').trim();

  const toList = to ?? (
    orig.direction === 'incoming'
      ? (orig.from_email ? [orig.from_email] : [])
      : (orig.to_raw?.split(/,\s*/).map(s => s.trim()).filter(Boolean) ?? [])
  );
  if (toList.length === 0) return NextResponse.json({ error: 'no_recipient' }, { status: 400 });

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
      cc_raw: cc?.join(', ') || null,
      bcc_raw: bcc?.join(', ') || null,
      subject: replySubject,
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
      thread_id: msg.thread_id,
      mailbox_id: msg.mailbox_id,
      sent_by_user_id: session!.userId,
      smtp_response: null,
      status: 'pending',
      error_message: null,
      sent_at: new Date()
    }
  });

  await prisma.threads.update({
    where: { id: orig.thread_id },
    data: {
      last_sent_at: new Date(),
      last_message_at: new Date(),
      last_replied_by_user_id: session!.userId
    }
  });

  await logAudit({
    actorUserId: session!.userId,
    actionType: 'reply_enqueued',
    targetType: 'threads',
    targetId: orig.thread_id,
    metadata: { message_id: msg.id }
  });

  sendMailForMessage(msg.id).catch((e) => {
    console.error('[reply] sendMailForMessage failed', msg.id, e?.message || e);
  });

  return NextResponse.json({ ok: true, message_id: msg.id });
}
