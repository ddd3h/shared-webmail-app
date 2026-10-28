import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { saveUploadedFiles, deleteStoredFiles } from '@/lib/attachment-storage';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachment-limits';
import { MAX_RECEIPTS, isEditable, isReceiptType } from '@/lib/expense';

// POST /api/expenses/:id/receipts - add receipts to your own pending/rejected claim (multipart)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const claim = await prisma.expense_claims.findUnique({ where: { id }, include: { _count: { select: { receipts: true } } } });
  if (!claim) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (claim.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!isEditable(claim)) return NextResponse.json({ error: 'not_editable' }, { status: 409 });

  let fd: FormData;
  try { fd = await req.formData(); } catch { return NextResponse.json({ error: 'file_too_large' }, { status: 413 }); }
  const files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
  if (files.length === 0) return NextResponse.json({ error: 'no_files' }, { status: 400 });
  if (claim._count.receipts + files.length > MAX_RECEIPTS) return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  if (files.some(f => f.size > MAX_ATTACHMENT_BYTES)) return NextResponse.json({ error: 'file_too_large' }, { status: 400 });
  if (files.some(f => !isReceiptType(f.type))) return NextResponse.json({ error: 'invalid_file_type' }, { status: 400 });

  const saved = await saveUploadedFiles(files);
  try {
    await prisma.expense_receipts.createMany({ data: saved.map(s => ({ ...s, claim_id: id })) });
  } catch (e) {
    await deleteStoredFiles(saved.map(s => s.storage_key));
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
