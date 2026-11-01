import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { unitSchema, unitProblem } from '@/lib/org-input';

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/org/units/:id - rename or move a 部署 (system admin only)
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = unitSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const before = await prisma.org_units.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const problem = await unitProblem(id, parsed.data);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  await prisma.org_units.update({ where: { id }, data: parsed.data });
  await logAudit({ actorUserId: actor.id, actionType: 'org_unit_update', targetType: 'org_units', targetId: id, metadata: { from: { name: before.name, parent_id: before.parent_id }, to: parsed.data } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/org/units/:id - only a unit without child units; its members leave it (and lose the 役職 they had there)
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const unit = await prisma.org_units.findUnique({ where: { id }, include: { _count: { select: { children: true, members: true } } } });
  if (!unit) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (unit._count.children > 0) return NextResponse.json({ error: 'has_children' }, { status: 409 });
  await prisma.org_units.delete({ where: { id } }); // the memberships go with it (cascade); evaluation forms keep their history with no 部署
  await logAudit({ actorUserId: actor.id, actionType: 'org_unit_delete', targetType: 'org_units', targetId: id, metadata: { name: unit.name, members: unit._count.members } });
  return NextResponse.json({ ok: true, removed_members: unit._count.members });
}
