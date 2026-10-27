import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { createBatch, isValidTransferDate } from '@/lib/transfer-server';
import type { CategoryCode } from '@/lib/zengin';

const day = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/transfers/batches - history of generated 全銀 files (finance staff only)
export async function GET() {
  if (!(await financeActor())) return forbidden();
  const rows = await prisma.transfer_batches.findMany({
    orderBy: { created_at: 'desc' }, take: 100,
    select: { id: true, kind: true, category_code: true, transfer_date: true, item_count: true, total_amount: true, file_name: true, created_at: true, paid_at: true, creator: { select: { name: true } } },
  });
  return NextResponse.json({
    items: rows.map(r => ({ ...r, transfer_date: day(r.transfer_date), paid_at: r.paid_at ? day(r.paid_at) : null, creator: r.creator?.name ?? null })),
  });
}

const itemSchema = z.object({ type: z.enum(['payslip', 'payment', 'expense']), ids: z.array(z.string().min(1)).min(1).max(500) });
const schema = z.object({
  kind: z.enum(['payment', 'payroll', 'monthly']),
  ids: z.array(z.string().min(1)).max(500).default([]),
  // monthly: everything to be transferred in one file
  items: z.array(itemSchema).max(500).optional(),
  category: z.enum(['21', '11', '12']).optional(),
  transfer_date: z.string().refine(isValidTransferDate),
  force: z.boolean().default(false),
}).refine(v => (v.kind === 'monthly' ? (v.items?.length ?? 0) > 0 : v.ids.length > 0), { message: 'nothing_selected' });

/** Payments are always 総合振込; payroll is 給与 unless 賞与 (or 総合) was asked for. */
function categoryFor(kind: 'payment' | 'payroll' | 'monthly', asked: string | undefined): CategoryCode {
  if (kind === 'payment' || kind === 'monthly') return '21'; // a file that mixes salaries, fees and payments is a 総合振込
  return asked === '12' ? '12' : asked === '21' ? '21' : '11';
}

// POST /api/transfers/batches - make a 全銀 file from payment requests or pay statements (finance staff only)
export async function POST(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const category = categoryFor(d.kind, d.category);

  const result = await createBatch({ kind: d.kind, ids: d.ids, items: d.items, category, transferDate: d.transfer_date, force: d.force, actorId: actor.id });
  if (!result.ok) return NextResponse.json({ error: result.error, message: result.message, problems: result.problems }, { status: result.status });
  await logAudit({
    actorUserId: actor.id, actionType: 'transfer_batch_create', targetType: 'transfer_batches', targetId: result.id,
    metadata: { kind: d.kind, category, items: d.items?.map(i => ({ type: i.type, n: i.ids.length })), count: result.count, total: result.total, transfer_date: d.transfer_date, force: d.force },
  });
  return NextResponse.json({ id: result.id, count: result.count, total: result.total, file_name: result.fileName }, { status: 201 });
}
