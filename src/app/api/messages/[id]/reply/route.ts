import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { sendMailForMessage } from '@/lib/mail/send-job';
import { deliverReply, type DeliverAttachment } from '@/lib/mail/deliver';
import { saveUploadedFiles } from '@/lib/attachment-storage';
import { resolveDraftAttachments, DraftAttachmentAccessError } from '@/lib/draft-access';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const contentType = req.headers.get('content-type') || '';
  let to: string[] | undefined, cc: string[] | undefined, bcc: string[] | undefined,
    subject: string | undefined, text: string | undefined, html: string | undefined,
    files: File[] = [], fromMailboxId: string | undefined;
  let draftAttachmentIds: string[] = [];

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
    draftAttachmentIds = fd.getAll('draft_attachment_id').map(String).filter(Boolean);
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

  // Save uploaded attachments to disk and adopt any carried over from a draft
  // (attachment DB rows are created once the message exists)
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
