import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin, isYearEndStaff } from '@/lib/work-auth';
import { isCapability } from '@/lib/org';
import { hasCapability } from '@/lib/org-server';

// GET /api/org - the organisation chart. Everybody may see who sits where; only admins also get e-mail addresses.
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const admin = isAdmin(actor);
  const canDesignate = admin || (await hasCapability(actor, 'hr_admin')); // may name each 部署's expense approvers / evaluators

  const [units, positions, users] = await Promise.all([
    prisma.org_units.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { id: true, name: true, parent_id: true, sort: true, pos_x: true, pos_y: true } }),
    prisma.org_positions.findMany({ orderBy: [{ level: 'desc' }, { name: 'asc' }], select: { id: true, name: true, level: true, permissions: true } }),
    prisma.users.findMany({ orderBy: { created_at: 'asc' }, select: { id: true, name: true, email: true, role: true, org_memberships: { select: { unit_id: true, position_id: true } } } }),
  ]);
  const permsOf = (positionId: string | null) => positions.find(p => p.id === positionId)?.permissions.filter(isCapability) ?? [];
  const me = users.find(u => u.id === actor.id);
  const myCaps = [...new Set((me?.org_memberships ?? []).flatMap(m => permsOf(m.position_id)))];
  return NextResponse.json({
    units,
    positions: positions.map(p => ({ ...p, permissions: p.permissions.filter(isCapability) })),
    // who is a system admin and the e-mail addresses are for admins only; `can_evaluate` is what the evaluator picker needs.
    // `memberships`: every 部署 of the person with their 役職 there.
    members: users.map(u => ({
      id: u.id, name: u.name,
      memberships: u.org_memberships.map(m => ({ unit_id: m.unit_id, position_id: m.position_id })),
      can_evaluate: u.role === 'admin' || u.org_memberships.some(m => permsOf(m.position_id).includes('evaluate')),
      ...(admin ? { role: u.role, email: u.email } : {}),
    })),
    // who each 部署 named (経費の承認者 / 評価者), in the order named; only for those who may change it
    designations: canDesignate ? (await prisma.org_unit_designations.findMany({ orderBy: [{ created_at: 'asc' }, { user_id: 'asc' }], select: { unit_id: true, user_id: true, kind: true } })) : [],
    me: { can_designate: canDesignate, id: actor.id, is_admin: admin, capabilities: admin ? ['approve_requests', 'evaluate', 'hr_admin'] : myCaps, can_year_end: isYearEndStaff(actor) },
  });
}
