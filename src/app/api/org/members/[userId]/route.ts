import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { memberSchema } from '@/lib/org-input';

// PUT /api/org/members/:userId - set where a person sits (部署) and their 役職 (system admin only)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = memberSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { org_unit_id, position_id } = parsed.data;

  const user = await prisma.users.findUnique({ where: { id: userId }, select: { org_unit_id: true, position_id: true } });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (org_unit_id && !(await prisma.org_units.findUnique({ where: { id: org_unit_id }, select: { id: true } }))) return NextResponse.json({ error: 'unit_not_found' }, { status: 400 });
  if (position_id && !(await prisma.org_positions.findUnique({ where: { id: position_id }, select: { id: true } }))) return NextResponse.json({ error: 'position_not_found' }, { status: 400 });

  await prisma.users.update({ where: { id: userId }, data: { org_unit_id, position_id } });
  await logAudit({ actorUserId: actor.id, actionType: 'org_member_update', targetType: 'users', targetId: userId, metadata: { from: user, to: { org_unit_id, position_id } } });
  return NextResponse.json({ ok: true });
}
