import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { checkAccess } from '@/lib/draft-access';
import { saveUploadedFiles } from '@/lib/attachment-storage';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@/lib/attachment-limits';

function serialize(a: { id: string; filename: string; content_type: string; size: number }) {
  return { id: a.id, filename: a.filename, content_type: a.content_type, size: a.size };
}

// GET /api/drafts/[id]/attachments - list a draft's attachments
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const { draft, accessible } = await checkAccess(id, session!.userId);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const attachments = await prisma.draft_attachments.findMany({
    where: { draft_id: id },
    orderBy: { created_at: 'asc' },
  });
  return NextResponse.json({ attachments: attachments.map(serialize) });
}

// POST /api/drafts/[id]/attachments - upload files onto a draft (multipart).
//
// Deliberately does NOT write to `drafts` itself: `updated_at` is @updatedAt, and
// bumping it would immediately invalidate the composer's optimistic lock
// (client_updated_at in PUT /api/drafts/[id]) and cause spurious 409s.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const { draft, accessible } = await checkAccess(id, session!.userId, true);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!accessible) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'expected_multipart' }, { status: 400 });
  }

  // A body over the proxy buffer limit arrives truncated, which makes formData()
  // throw — report that as "too large" instead of a 500.
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  const files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
  if (files.length === 0) return NextResponse.json({ error: 'no_files' }, { status: 400 });

  if (files.some(f => f.size > MAX_ATTACHMENT_BYTES)) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 400 });
  }
  const existing = await prisma.draft_attachments.count({ where: { draft_id: id } });
  if (existing + files.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  }

  const saved = await saveUploadedFiles(files);
  await prisma.draft_attachments.createMany({
    data: saved.map(a => ({
      draft_id: id,
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
      storage_key: a.storage_key,
    })),
  });

  const attachments = await prisma.draft_attachments.findMany({
    where: { draft_id: id },
    orderBy: { created_at: 'asc' },
  });
  return NextResponse.json({ ok: true, attachments: attachments.map(serialize) });
}
