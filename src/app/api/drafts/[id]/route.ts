import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { checkAccess } from '@/lib/draft-access';
import { deleteStoredFiles } from '@/lib/attachment-storage';

// GET /api/drafts/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const { draft, accessible } = await checkAccess(id, session!.userId);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const attachments = await prisma.draft_attachments.findMany({
    where: { draft_id: draft.id },
    orderBy: { created_at: 'asc' },
    select: { id: true, filename: true, content_type: true, size: true },
  });

  const response: Record<string, unknown> = { ...draft, attachments };
  if (draft.yjs_state) {
    response.yjs_state_b64 = draft.yjs_state.toString('base64');
  }
  delete response.yjs_state; // don't send raw bytes in JSON

  return NextResponse.json(response);
}

// PUT /api/drafts/[id] - update draft (with optimistic lock for non-body fields)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const { draft, accessible } = await checkAccess(id, session!.userId, true);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // Optimistic lock — only enforced when caller sends client_updated_at
  if (body.client_updated_at !== undefined) {
    const clientTs = new Date(body.client_updated_at).getTime();
    const serverTs = draft.updated_at.getTime();
    if (clientTs !== serverTs) {
      return NextResponse.json(
        {
          error: 'conflict',
          server_updated_at: draft.updated_at.toISOString(),
          updated_by_name: draft.updatedBy?.name ?? null,
        },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.drafts.update({
    where: { id },
    data: {
      mailbox_id: body.mailbox_id ?? draft.mailbox_id,
      thread_id: body.thread_id ?? draft.thread_id,
      to_raw: body.to_raw ?? draft.to_raw,
      cc_raw: body.cc_raw ?? draft.cc_raw,
      bcc_raw: body.bcc_raw ?? draft.bcc_raw,
      subject: body.subject ?? draft.subject,
      html_body: body.html_body ?? draft.html_body,
      text_body: body.text_body ?? draft.text_body,
      is_shared: body.is_shared !== undefined ? !!body.is_shared : draft.is_shared,
      updated_by_id: session!.userId,
    },
  });

  return NextResponse.json({ ok: true, updated_at: updated.updated_at.toISOString() });
}

// DELETE /api/drafts/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const { draft, accessible } = await checkAccess(id, session!.userId, true);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Attachment rows cascade with the draft; their files on disk do not, so
  // collect the keys first and unlink after the row is gone.
  const attachments = await prisma.draft_attachments.findMany({
    where: { draft_id: id },
    select: { storage_key: true },
  });
  await prisma.drafts.delete({ where: { id } });
  await deleteStoredFiles(attachments.map(a => a.storage_key));

  return NextResponse.json({ ok: true });
}
