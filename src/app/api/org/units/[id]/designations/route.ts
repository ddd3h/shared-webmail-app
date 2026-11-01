import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin } from '@/lib/work-auth';
import { hasCapability } from '@/lib/org-server';

const schema = z.object({ kind: z.enum(['expense', 'evaluation']), user_ids: z.array(z.string().min(1)).max(20) });

/** Admins and HR (人事) decide who approves a 部署's expense claims and who evaluates its members. */
async function canDesignate(userId: string): Promise<boolean> {
  const actor = await getActor(userId);
  return !!actor && (isAdmin(actor) || (await hasCapability(actor, 'hr_admin')));
}

// PUT /api/org/units/:id/designations { kind: 'expense' | 'evaluation', user_ids } - name the approvers (経費) or evaluators (人事評価) of a 部署.
// The order is the order of naming (for evaluators the first one evaluates; a person is never their own evaluator). An empty list = back to the 役職 rule.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  if (!(await canDesignate(session.userId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { kind } = parsed.data;
  const userIds = [...new Set(parsed.data.user_ids)];
  const [unit, users, before] = await Promise.all([
    prisma.org_units.findUnique({ where: { id }, select: { id: true, name: true } }),
    prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true } }),
    prisma.org_unit_designations.findMany({ where: { unit_id: id, kind }, orderBy: [{ created_at: 'asc' }, { user_id: 'asc' }], select: { user_id: true } }),
  ]);
  if (!unit) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // HR may not name THEMSELVES as the one who approves a 部署's expenses (who decides on money is not up to the person who gains it): an admin does that
  const admin = isAdmin((await getActor(session.userId))!);
  const had = new Set(before.map(b => b.user_id));
  if (kind === 'expense' && !admin && userIds.includes(session.userId) && !had.has(session.userId)) return NextResponse.json({ error: 'self_designation' }, { status: 403 });
  if (users.length !== userIds.length) return NextResponse.json({ error: 'invalid_user' }, { status: 400 });
  const keep = new Set(userIds);
  // keep the people already named where they are (so the order they were named in stays); newly named ones go after them, in the order given
  const now = Date.now();
  await prisma.$transaction([
    prisma.org_unit_designations.deleteMany({ where: { unit_id: id, kind, user_id: { notIn: userIds } } }),
    ...userIds.filter(u => !had.has(u)).map((user_id, i) => prisma.org_unit_designations.create({ data: { unit_id: id, user_id, kind, created_at: new Date(now + i) } })),
  ]);
  await logAudit({ actorUserId: session.userId, actionType: 'org_unit_designations', targetType: 'org_units', targetId: id, metadata: { kind, from: before.map(b => b.user_id), to: userIds.filter(u => keep.has(u)) } });
  return NextResponse.json({ ok: true });
}
