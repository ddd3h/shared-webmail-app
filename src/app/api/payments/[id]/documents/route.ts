import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { saveUploadedFiles, deleteStoredFiles } from '@/lib/attachment-storage';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachment-limits';
import { isReceiptType } from '@/lib/expense';
import { MAX_DOCUMENTS } from '@/lib/payment';

// POST /api/payments/:id/documents - add invoices to your own pending/rejected request (multipart)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const r = await prisma.payment_requests.findUnique({ where: { id }, include: { _count: { select: { documents: true } } } });
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (r.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (r.status !== 'pending' && r.status !== 'rejected') return NextResponse.json({ error: 'not_editable' }, { status: 409 });

  let fd: FormData;
  try { fd = await req.formData(); } catch { return NextResponse.json({ error: 'file_too_large' }, { status: 413 }); }
  const files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
  if (files.length === 0) return NextResponse.json({ error: 'no_files' }, { status: 400 });
  if (r._count.documents + files.length > MAX_DOCUMENTS) return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  if (files.some(f => f.size > MAX_ATTACHMENT_BYTES)) return NextResponse.json({ error: 'file_too_large' }, { status: 400 });
  if (files.some(f => !isReceiptType(f.type))) return NextResponse.json({ error: 'invalid_file_type' }, { status: 400 });

  const saved = await saveUploadedFiles(files);
  try {
    await prisma.payment_documents.createMany({ data: saved.map(s => ({ ...s, request_id: id })) });
  } catch (e) {
    await deleteStoredFiles(saved.map(s => s.storage_key));
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
