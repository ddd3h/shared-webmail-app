import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';

// GET /api/trips/allowance-types - the 日当 / 加算金 rate master. Admins can pass ?all=1 to include inactive ones.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const all = new URL(req.url).searchParams.get('all') === '1' && isFinance(actor);
  const items = await prisma.trip_allowance_types.findMany({
    where: all ? {} : { is_active: true },
    orderBy: [{ sort: 'asc' }, { created_at: 'asc' }],
  });
  return NextResponse.json({ items });
}

const typeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['daily', 'addon']),
  unit: z.enum(['per_day', 'per_night', 'per_trip']),
  amount: z.number().int().min(0).max(10_000_000),
  description: z.string().trim().max(300).nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

// POST /api/trips/allowance-types - add a rate (admin only)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = typeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const row = await prisma.trip_allowance_types.create({
    data: { name: d.name, kind: d.kind, unit: d.unit, amount: d.amount, description: d.description || null, sort: d.sort ?? 100, is_active: d.is_active ?? true },
  });
  await logAudit({ actorUserId: actor.id, actionType: 'trip_allowance_type_create', targetType: 'trip_allowance_types', targetId: row.id, metadata: { name: d.name, amount: d.amount } });
  return NextResponse.json({ id: row.id }, { status: 201 });
}
