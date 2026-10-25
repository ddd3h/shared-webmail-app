import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { unitSchema, unitProblem } from '@/lib/org-input';

// POST /api/org/units - add a 部署 (system admin only)
export async function POST(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = unitSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const problem = await unitProblem(null, parsed.data);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const unit = await prisma.org_units.create({ data: parsed.data });
  await logAudit({ actorUserId: actor.id, actionType: 'org_unit_create', targetType: 'org_units', targetId: unit.id, metadata: { name: unit.name, parent_id: unit.parent_id } });
  return NextResponse.json({ id: unit.id }, { status: 201 });
}
