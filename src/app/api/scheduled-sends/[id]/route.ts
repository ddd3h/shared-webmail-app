import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// DELETE /api/scheduled-sends/[id] - cancel a pending scheduled send (owner only).
// The composed content is kept as a draft rather than discarded, so canceling
// isn't a dead end — the user can reopen and finish sending it themselves.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const scheduled = await prisma.scheduled_sends.findUnique({ where: { id } });
  if (!scheduled || scheduled.user_id !== session!.userId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (scheduled.status !== 'pending') {
    return NextResponse.json({ error: 'already_processed' }, { status: 409 });
  }

  const [draft] = await prisma.$transaction([
    prisma.drafts.create({
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
    }),
    prisma.scheduled_sends.update({
      where: { id },
      data: { status: 'canceled' }
    })
  ]);

  return NextResponse.json({ ok: true, draftId: draft.id, threadId: scheduled.thread_id });
}
