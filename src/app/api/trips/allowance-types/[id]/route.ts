import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['daily', 'addon']),
  unit: z.enum(['per_day', 'per_night', 'per_trip']),
  amount: z.number().int().min(0).max(10_000_000),
  description: z.string().trim().max(300).nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

async function adminOnly() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor && isFinance(actor) ? actor : null;
}

// PUT /api/trips/allowance-types/:id - change a rate. Existing trip requests keep the amounts they were calculated with.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  if (!(await prisma.trip_allowance_types.findUnique({ where: { id } }))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.trip_allowance_types.update({
    where: { id },
    data: { name: d.name, kind: d.kind, unit: d.unit, amount: d.amount, description: d.description || null, ...(d.sort !== undefined ? { sort: d.sort } : {}), ...(d.is_active !== undefined ? { is_active: d.is_active } : {}) },
  });
  await logAudit({ actorUserId: actor.id, actionType: 'trip_allowance_type_update', targetType: 'trip_allowance_types', targetId: id, metadata: { name: d.name, amount: d.amount } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/trips/allowance-types/:id - delete, or just switch off when requests already used it
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await prisma.trip_allowance_types.findUnique({ where: { id } }))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const used = await prisma.trip_allowance_lines.count({ where: { type_id: id } });
  if (used > 0) await prisma.trip_allowance_types.update({ where: { id }, data: { is_active: false } });
  else await prisma.trip_allowance_types.delete({ where: { id } });
  await logAudit({ actorUserId: actor.id, actionType: 'trip_allowance_type_delete', targetType: 'trip_allowance_types', targetId: id, metadata: { deactivated: used > 0 } });
  return NextResponse.json({ ok: true, deactivated: used > 0 });
}
