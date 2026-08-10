import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { sendMailForMessage } from '@/lib/mail/send-job';
import { deliverCompose, type DeliverAttachment } from '@/lib/mail/deliver';
import { saveUploadedFiles } from '@/lib/attachment-storage';
import { resolveDraftAttachments, DraftAttachmentAccessError } from '@/lib/draft-access';

// POST /api/messages/compose - send a brand-new email (not a reply)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const contentType = req.headers.get('content-type') || '';
  let mailbox_id: string, to: string[], cc: string[] | undefined, bcc: string[] | undefined,
    subject: string, text: string | undefined, html: string | undefined, files: File[] = [];
  let draftAttachmentIds: string[] = [];

  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData();
    mailbox_id = fd.get('mailbox_id') as string;
    to = JSON.parse((fd.get('to') as string) || '[]');
    cc = fd.has('cc') ? JSON.parse(fd.get('cc') as string) : undefined;
    bcc = fd.has('bcc') ? JSON.parse(fd.get('bcc') as string) : undefined;
    subject = fd.get('subject') as string;
    text = (fd.get('text') as string) || undefined;
    html = (fd.get('html') as string) || undefined;
    files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
    draftAttachmentIds = fd.getAll('draft_attachment_id').map(String).filter(Boolean);
  } else {
    const body = await req.json().catch(() => ({}));
    ({ mailbox_id, subject } = body);
    to = body.to || [];
    cc = body.cc;
    bcc = body.bcc;
    text = body.text;
    html = body.html;
  }

  if (!mailbox_id || !subject || !to?.length) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const mailbox = await prisma.mailboxes.findUnique({ where: { id: mailbox_id } });
  if (!mailbox) return NextResponse.json({ error: 'mailbox_not_found' }, { status: 404 });
  if (!(await canReplyMailbox(session!.userId, mailbox_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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

  const { threadId, messageId } = await deliverCompose({
    mailboxId: mailbox_id,
    userId: session!.userId,
    to, cc, bcc, subject, text, html,
    attachments
  });

  sendMailForMessage(messageId).catch((e) => {
    console.error('[compose] sendMailForMessage failed', messageId, e?.message || e);
  });

  return NextResponse.json({ ok: true, thread_id: threadId, message_id: messageId });
}
