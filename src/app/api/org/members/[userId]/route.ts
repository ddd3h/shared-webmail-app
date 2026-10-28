import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { memberSchema } from '@/lib/org-input';

// PUT /api/org/members/:userId - set every 部署 a person belongs to, with their 役職 in each (system admin only).
// The list replaces what they had: a person may be in several 部署 with a different 役職 in each (班長 in one, 部長 in another).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = memberSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { memberships } = parsed.data;

  const user = await prisma.users.findUnique({ where: { id: userId }, select: { org_memberships: { select: { unit_id: true, position_id: true } } } });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const unitIds = memberships.map(m => m.unit_id);
  if (new Set(unitIds).size !== unitIds.length) return NextResponse.json({ error: 'duplicate_unit' }, { status: 400 });
  if (unitIds.length && (await prisma.org_units.count({ where: { id: { in: unitIds } } })) !== unitIds.length) return NextResponse.json({ error: 'unit_not_found' }, { status: 400 });
  const positionIds = [...new Set(memberships.map(m => m.position_id).filter((x): x is string => !!x))];
  if (positionIds.length && (await prisma.org_positions.count({ where: { id: { in: positionIds } } })) !== positionIds.length) return NextResponse.json({ error: 'position_not_found' }, { status: 400 });

  await prisma.$transaction([
    prisma.org_memberships.deleteMany({ where: { user_id: userId } }),
    ...(memberships.length ? [prisma.org_memberships.createMany({ data: memberships.map(m => ({ user_id: userId, unit_id: m.unit_id, position_id: m.position_id })) })] : []),
  ]);
  await logAudit({ actorUserId: actor.id, actionType: 'org_member_update', targetType: 'users', targetId: userId, metadata: { from: user.org_memberships, to: memberships } });
  return NextResponse.json({ ok: true });
}
