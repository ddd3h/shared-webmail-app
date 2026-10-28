import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';

const LIMIT = 5000; // how far from the middle the diagram may be moved (keeps a wild drag from storing nonsense)
const num = z.number().finite().min(-LIMIT * 20).max(LIMIT * 20);
const schema = z.object({ positions: z.array(z.object({ id: z.string().min(1), x: num, y: num })).min(1).max(500) });

// PUT /api/org/layout - where the 部署 sit on the org diagram (system admin only). Only places are stored; who reports to whom is the
// 部署's parent (PUT /api/org/units/:id).
export async function PUT(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { positions } = parsed.data;
  const ids = positions.map(p => p.id);
  if (new Set(ids).size !== ids.length) return NextResponse.json({ error: 'duplicate_unit' }, { status: 400 });
  if ((await prisma.org_units.count({ where: { id: { in: ids } } })) !== ids.length) return NextResponse.json({ error: 'unit_not_found' }, { status: 400 });
  await prisma.$transaction(positions.map(p => prisma.org_units.update({ where: { id: p.id }, data: { pos_x: Math.round(p.x), pos_y: Math.round(p.y) } })));
  await logAudit({ actorUserId: actor.id, actionType: 'org_layout_update', targetType: 'org_units', metadata: { count: positions.length } });
  return NextResponse.json({ ok: true });
}
