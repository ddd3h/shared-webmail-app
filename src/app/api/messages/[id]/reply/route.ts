import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { sendMailForMessage } from '@/lib/mail/send-job';
import { deliverReply, type DeliverAttachment } from '@/lib/mail/deliver';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { APP_ROOT } from '@/lib/app-root';

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

  const orig = await prisma.messages.findUnique({ where: { id } });
  if (!orig) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canReplyMailbox(session!.userId, orig.mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (fromMailboxId && fromMailboxId !== orig.mailbox_id) {
    if (!(await canReplyMailbox(session!.userId, fromMailboxId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  const toList = to ?? (
    orig.direction === 'incoming'
      ? (orig.from_email ? [orig.from_email] : [])
      : (orig.to_raw?.split(/,\s*/).map(s => s.trim()).filter(Boolean) ?? [])
  );
  if (toList.length === 0) return NextResponse.json({ error: 'no_recipient' }, { status: 400 });

  // Save uploaded attachments to disk (attachment DB rows are created once the message exists)
  const attachments: DeliverAttachment[] = [];
  if (files.length > 0) {
    const storageDir = path.join(APP_ROOT, 'storage', 'attachments');
    await mkdir(storageDir, { recursive: true });
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
      const storageKey = path.join('storage', 'attachments', `${crypto.randomUUID()}${ext}`);
      await writeFile(path.join(APP_ROOT, storageKey), buffer);
      attachments.push({
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        size: file.size,
        storage_key: storageKey
      });
    }
  }

  const { messageId } = await deliverReply({
    origMessageId: id,
    fromMailboxId,
    userId: session!.userId,
    to: toList, cc, bcc, subject, text, html,
    attachments
  });

  sendMailForMessage(messageId).catch((e) => {
    console.error('[reply] sendMailForMessage failed', messageId, e?.message || e);
  });

  return NextResponse.json({ ok: true, message_id: messageId });
}
