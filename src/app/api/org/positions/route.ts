import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { positionSchema } from '@/lib/org-input';

// POST /api/org/positions - add a 役職 with its permissions (system admin only)
export async function POST(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = positionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  if (await prisma.org_positions.findUnique({ where: { name: parsed.data.name } })) return NextResponse.json({ error: 'duplicate_name' }, { status: 409 });
  const p = await prisma.org_positions.create({ data: parsed.data });
  await logAudit({ actorUserId: actor.id, actionType: 'org_position_create', targetType: 'org_positions', targetId: p.id, metadata: { name: p.name, permissions: p.permissions } });
  return NextResponse.json({ id: p.id }, { status: 201 });
}
