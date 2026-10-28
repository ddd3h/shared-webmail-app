import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { memberSchema } from '@/lib/org-input';

// PUT /api/org/members/:userId - set where a person sits (主所属の部署 and 兼務の部署) and their 役職 (system admin only)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = memberSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { org_unit_id, position_id } = parsed.data;

  const user = await prisma.users.findUnique({ where: { id: userId }, select: { org_unit_id: true, position_id: true, extra_units: { select: { unit_id: true } } } });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (org_unit_id && !(await prisma.org_units.findUnique({ where: { id: org_unit_id }, select: { id: true } }))) return NextResponse.json({ error: 'unit_not_found' }, { status: 400 });
  if (position_id && !(await prisma.org_positions.findUnique({ where: { id: position_id }, select: { id: true } }))) return NextResponse.json({ error: 'position_not_found' }, { status: 400 });

  // 兼務: only with a main 部署, never the main one again, each unit once. Not sent = unchanged.
  const before = user.extra_units.map(e => e.unit_id);
  let extra = parsed.data.extra_unit_ids === undefined ? before : [...new Set(parsed.data.extra_unit_ids)];
  if (!org_unit_id) extra = [];
  extra = extra.filter(id => id !== org_unit_id);
  if (extra.length) {
    const found = await prisma.org_units.count({ where: { id: { in: extra } } });
    if (found !== extra.length) return NextResponse.json({ error: 'unit_not_found' }, { status: 400 });
  }
  await prisma.$transaction([
    prisma.users.update({ where: { id: userId }, data: { org_unit_id, position_id } }),
    prisma.org_unit_extra_members.deleteMany({ where: { user_id: userId } }),
    ...(extra.length ? [prisma.org_unit_extra_members.createMany({ data: extra.map(unit_id => ({ user_id: userId, unit_id })) })] : []),
  ]);
  await logAudit({ actorUserId: actor.id, actionType: 'org_member_update', targetType: 'users', targetId: userId, metadata: { from: { org_unit_id: user.org_unit_id, position_id: user.position_id, extra_unit_ids: before }, to: { org_unit_id, position_id, extra_unit_ids: extra } } });
  return NextResponse.json({ ok: true });
}
