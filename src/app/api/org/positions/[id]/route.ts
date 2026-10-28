import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { positionSchema } from '@/lib/org-input';

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/org/positions/:id - rename or change the permissions (takes effect for everybody holding it at once)
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = positionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const before = await prisma.org_positions.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const same = await prisma.org_positions.findUnique({ where: { name: parsed.data.name } });
  if (same && same.id !== id) return NextResponse.json({ error: 'duplicate_name' }, { status: 409 });
  await prisma.org_positions.update({ where: { id }, data: parsed.data });
  await logAudit({ actorUserId: actor.id, actionType: 'org_position_update', targetType: 'org_positions', targetId: id, metadata: { name: parsed.data.name, from: before.permissions, to: parsed.data.permissions } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/org/positions/:id - the people holding it simply have no 役職 afterwards
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const p = await prisma.org_positions.findUnique({ where: { id }, include: { _count: { select: { members: true } } } });
  if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.org_positions.delete({ where: { id } });
  await logAudit({ actorUserId: actor.id, actionType: 'org_position_delete', targetType: 'org_positions', targetId: id, metadata: { name: p.name, members: p._count.members } });
  return NextResponse.json({ ok: true, unassigned: p._count.members });
}
