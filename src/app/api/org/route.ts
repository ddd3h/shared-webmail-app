import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin, isYearEndStaff } from '@/lib/work-auth';
import { isCapability, scopeOf } from '@/lib/org';
import { loadUnits } from '@/lib/org-server';

// GET /api/org - the organisation chart. Everybody may see who sits where; only admins also get e-mail addresses.
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const admin = isAdmin(actor);

  const [units, positions, users, all] = await Promise.all([
    prisma.org_units.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { id: true, name: true, parent_id: true, head_user_id: true, sort: true } }),
    prisma.org_positions.findMany({ orderBy: [{ level: 'desc' }, { name: 'asc' }], select: { id: true, name: true, level: true, permissions: true } }),
    prisma.users.findMany({ orderBy: { created_at: 'asc' }, select: { id: true, name: true, email: true, role: true, org_unit_id: true, position_id: true } }),
    loadUnits(),
  ]);
  const me = users.find(u => u.id === actor.id);
  const myPosition = positions.find(p => p.id === me?.position_id);
  return NextResponse.json({
    units,
    positions: positions.map(p => ({ ...p, permissions: p.permissions.filter(isCapability) })),
    // who is a system admin and the e-mail addresses are for admins only; `can_evaluate` is what the evaluator picker needs
    members: users.map(u => ({
      id: u.id, name: u.name, org_unit_id: u.org_unit_id, position_id: u.position_id,
      can_evaluate: u.role === 'admin' || !!positions.find(p => p.id === u.position_id)?.permissions.includes('evaluate'),
      ...(admin ? { role: u.role, email: u.email } : {}),
    })),
    me: { id: actor.id, is_admin: admin, capabilities: admin ? ['approve_requests', 'evaluate', 'hr_admin'] : (myPosition?.permissions ?? []).filter(isCapability), headed_unit_ids: [...scopeOf(all, actor.id)], can_year_end: isYearEndStaff(actor) },
  });
}
