import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { checkAccess } from '@/lib/draft-access';
import { deleteStoredFiles } from '@/lib/attachment-storage';
import { createReadStream } from 'fs';
import path from 'path';
import { APP_ROOT } from '@/lib/app-root';

// GET /api/drafts/[id]/attachments/[attId] - download a draft attachment
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  const session = await getSession();
  requireAuth(session);

  const { draft, accessible } = await checkAccess(id, session!.userId);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const att = await prisma.draft_attachments.findUnique({ where: { id: attId } });
  if (!att || att.draft_id !== draft.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const stream = createReadStream(path.join(APP_ROOT, att.storage_key));
  return new NextResponse(stream as any, {
    headers: {
      'Content-Type': att.content_type,
      'Content-Length': String(att.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
    },
  });
}

// DELETE /api/drafts/[id]/attachments/[attId] - remove a draft attachment and its file
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  const session = await getSession();
  requireAuth(session);

  const { draft, accessible } = await checkAccess(id, session!.userId, true);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const att = await prisma.draft_attachments.findUnique({ where: { id: attId } });
  if (!att || att.draft_id !== draft.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.draft_attachments.delete({ where: { id: attId } });
  await deleteStoredFiles([att.storage_key]);

  const attachments = await prisma.draft_attachments.findMany({
    where: { draft_id: id },
    orderBy: { created_at: 'asc' },
  });
  return NextResponse.json({
    ok: true,
    attachments: attachments.map(a => ({ id: a.id, filename: a.filename, content_type: a.content_type, size: a.size })),
  });
}
