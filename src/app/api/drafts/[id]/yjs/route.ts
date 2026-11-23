import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import * as Y from 'yjs';

// PUT /api/drafts/[id]/yjs — save Yjs binary state (Content-Type: application/octet-stream).
// POST is the same: a page that is closing sends it as a beacon (navigator.sendBeacon can only POST).
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

  const incoming = new Uint8Array(await req.arrayBuffer());
  if (incoming.byteLength === 0) return NextResponse.json({ error: 'empty' }, { status: 400 });

  // Merge into what is stored instead of replacing it: a browser that was not connected to the others (the collaboration
  // server was down, or it opened the draft before they wrote) sends a state without their text, and replacing would drop it.
  // Yjs merges are order-free and repeatable, so saving the same state twice, or two people saving at once, loses nothing.
  // The row is locked while merging so two saves at the same moment do not overwrite each other.
  try {
    await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ yjs_state: Uint8Array | null }[]>`SELECT yjs_state FROM drafts WHERE id = ${id} FOR UPDATE`;
      const doc = new Y.Doc();
      if (rows[0]?.yjs_state) Y.applyUpdate(doc, new Uint8Array(rows[0].yjs_state));
      Y.applyUpdate(doc, incoming);
      await tx.drafts.update({ where: { id }, data: { yjs_state: Buffer.from(Y.encodeStateAsUpdate(doc)) } });
      doc.destroy();
    });
  } catch {
    // not a Yjs update (or the draft went away meanwhile)
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export const POST = PUT;
