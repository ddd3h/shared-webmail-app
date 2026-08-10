import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { copyStoredFile } from '@/lib/attachment-storage';

// DELETE /api/scheduled-sends/[id] - cancel a pending scheduled send (owner only).
// The composed content is kept as a draft rather than discarded, so canceling
// isn't a dead end — the user can reopen and finish sending it themselves.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const scheduled = await prisma.scheduled_sends.findUnique({
    where: { id },
    include: { attachments: true },
  });
  if (!scheduled || scheduled.user_id !== session!.userId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (scheduled.status !== 'pending') {
    return NextResponse.json({ error: 'already_processed' }, { status: 409 });
  }

  // The canceled scheduled_sends row keeps its own attachment rows and files, so
  // the draft gets its own copies rather than sharing storage keys.
  const carriedFiles = await Promise.all(
    scheduled.attachments.map(async a => ({
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
      storage_key: await copyStoredFile(a.storage_key, a.filename),
    }))
  );

  const draft = await prisma.$transaction(async (tx) => {
    const created = await tx.drafts.create({
      data: {
        user_id: scheduled.user_id,
        mailbox_id: scheduled.mailbox_id,
        thread_id: scheduled.thread_id,
        to_raw: scheduled.to_raw,
        cc_raw: scheduled.cc_raw,
        bcc_raw: scheduled.bcc_raw,
        subject: scheduled.subject,
        html_body: scheduled.html_body,
        text_body: scheduled.text_body,
        updated_by_id: scheduled.user_id,
      }
    });
    if (carriedFiles.length > 0) {
      await tx.draft_attachments.createMany({
        data: carriedFiles.map(a => ({ draft_id: created.id, ...a })),
      });
    }
    await tx.scheduled_sends.update({
      where: { id },
      data: { status: 'canceled' }
    });
    return created;
  });

  return NextResponse.json({ ok: true, draftId: draft.id, threadId: scheduled.thread_id });
}
