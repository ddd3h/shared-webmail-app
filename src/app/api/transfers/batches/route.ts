import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { createBatch, isValidTransferDate } from '@/lib/transfer-server';

// GET /api/transfers/batches - history of generated 全銀 files (finance staff only)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const rows = await prisma.transfer_batches.findMany({
    orderBy: { created_at: 'desc' }, take: 100,
    select: { id: true, kind: true, category_code: true, transfer_date: true, item_count: true, total_amount: true, file_name: true, created_at: true, paid_at: true, creator: { select: { name: true } } },
  });
  return NextResponse.json({
    items: rows.map(r => ({ ...r, transfer_date: r.transfer_date.toISOString().slice(0, 10), paid_at: r.paid_at ? r.paid_at.toISOString().slice(0, 10) : null, creator: r.creator?.name ?? null })),
  });
}

const schema = z.object({
  kind: z.enum(['payment', 'payroll']),
  ids: z.array(z.string().min(1)).min(1).max(500),
  category: z.enum(['21', '11', '12']).optional(),
  transfer_date: z.string().refine(isValidTransferDate),
  force: z.boolean().default(false),
});

// POST /api/transfers/batches - make a 全銀 file from payment requests or pay statements (finance staff only)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  // payments are always 総合振込; payroll is 給与 (default) or 賞与
  const category = d.kind === 'payment' ? '21' : d.category === '12' ? '12' : d.category === '21' ? '21' : '11';
  const result = await createBatch({ kind: d.kind, ids: d.ids, category, transferDate: d.transfer_date, force: d.force, actorId: actor.id });
  if (!result.ok) return NextResponse.json({ error: result.error, message: result.message, problems: result.problems }, { status: result.status });
  await logAudit({
    actorUserId: actor.id, actionType: 'transfer_batch_create', targetType: 'transfer_batches', targetId: result.id,
    metadata: { kind: d.kind, category, count: result.count, total: result.total, transfer_date: d.transfer_date, force: d.force },
  });
  return NextResponse.json({ id: result.id, count: result.count, total: result.total, file_name: result.fileName }, { status: 201 });
}
