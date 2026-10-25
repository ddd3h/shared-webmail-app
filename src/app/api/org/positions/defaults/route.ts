import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { DEFAULT_POSITIONS } from '@/lib/org';

// POST /api/org/positions/defaults - add the standard 役職 (部長・課長・チームリーダー・メンバー) that don't exist yet
export async function POST() {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const existing = new Set((await prisma.org_positions.findMany({ select: { name: true } })).map(p => p.name));
  const missing = DEFAULT_POSITIONS.filter(p => !existing.has(p.name));
  if (missing.length > 0) await prisma.org_positions.createMany({ data: missing });
  await logAudit({ actorUserId: actor.id, actionType: 'org_position_defaults', targetType: 'org_positions', metadata: { created: missing.map(p => p.name) } });
  return NextResponse.json({ created: missing.length });
}
