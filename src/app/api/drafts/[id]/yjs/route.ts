import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// PUT /api/drafts/[id]/yjs — save Yjs binary state (Content-Type: application/octet-stream)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const draft = await prisma.drafts.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (draft.user_id !== session!.userId) {
    if (!draft.is_shared || !draft.mailbox_id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const accessible = await prisma.mailboxes.findFirst({
      where: {
        id: draft.mailbox_id,
        OR: [
          { type: 'personal', owner_user_id: session!.userId },
          { permissions: { some: { user_id: session!.userId, can_reply: true } } },
        ],
      },
      select: { id: true },
    });
    if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  await prisma.drafts.update({ where: { id }, data: { yjs_state: buffer } });
  return NextResponse.json({ ok: true });
}
