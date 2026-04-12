import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// GET /api/drafts/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const draft = await prisma.drafts.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // must own it, or it's a shared draft from an accessible mailbox
  if (draft.user_id !== session.userId && !draft.is_shared) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json(draft);
}

// PUT /api/drafts/[id] - update draft
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const draft = await prisma.drafts.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (draft.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const updated = await prisma.drafts.update({
    where: { id },
    data: {
      mailbox_id: body.mailbox_id ?? draft.mailbox_id,
      thread_id: body.thread_id ?? draft.thread_id,
      to_raw: body.to_raw ?? draft.to_raw,
      cc_raw: body.cc_raw ?? draft.cc_raw,
      subject: body.subject ?? draft.subject,
      html_body: body.html_body ?? draft.html_body,
      text_body: body.text_body ?? draft.text_body,
      is_shared: body.is_shared !== undefined ? !!body.is_shared : draft.is_shared
    }
  });

  return NextResponse.json({ ok: true, updated_at: updated.updated_at });
}

// DELETE /api/drafts/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const draft = await prisma.drafts.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (draft.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  await prisma.drafts.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
