// DB side of the organisation: who has which permission, and for whom.
// A permission comes from the person's 役職 and applies only inside the units they head (and the units below).
import { prisma } from '@/lib/db';
import { scopeOf, withDescendants, type Capability, type Unit, isCapability } from '@/lib/org';

export type OrgUser = { id: string; role: string };
type Loaded = { units: Unit[]; capsOf: (userId: string) => Capability[] };

export async function loadUnits(): Promise<Unit[]> {
  return prisma.org_units.findMany({ select: { id: true, parent_id: true, head_user_id: true } });
}

const toCaps = (permissions: string[] | undefined): Capability[] => (permissions ?? []).filter(isCapability);

/** Permissions granted by a person's 役職 (admins are handled separately: they can do everything). */
export async function capabilitiesOf(userId: string): Promise<Capability[]> {
  const u = await prisma.users.findUnique({ where: { id: userId }, select: { position: { select: { permissions: true } } } });
  return toCaps(u?.position?.permissions);
}

/** Loads units and everybody's permissions once, for code that needs to ask about many people. */
export async function loadOrg(): Promise<Loaded> {
  const [units, users] = await Promise.all([
    loadUnits(),
    prisma.users.findMany({ select: { id: true, role: true, position: { select: { permissions: true } } } }),
  ]);
  const caps = new Map(users.map(u => [u.id, u.role === 'admin' ? (['approve_requests', 'evaluate', 'hr_admin'] as Capability[]) : toCaps(u.position?.permissions)]));
  return { units, capsOf: id => caps.get(id) ?? [] };
}

/** True for admins, or for people whose 役職 grants `cap`. No scope check: use canReviewUser for per-person questions. */
export async function hasCapability(actor: OrgUser, cap: Capability): Promise<boolean> {
  return actor.role === 'admin' || (await capabilitiesOf(actor.id)).includes(cap);
}

/** Users the actor may act on with `cap`: members of the units they head (and below). Never includes the actor. */
export async function usersInScope(actor: OrgUser, cap: Capability): Promise<string[]> {
  if (!(await capabilitiesOf(actor.id)).includes(cap)) return [];
  const scope = scopeOf(await loadUnits(), actor.id);
  if (scope.size === 0) return [];
  const rows = await prisma.users.findMany({ where: { org_unit_id: { in: [...scope] }, id: { not: actor.id } }, select: { id: true } });
  return rows.map(r => r.id);
}

/** May `actor` approve/reject the request of `targetUserId`? Admins always (self-approval is checked by the route). */
export async function canReviewUser(actor: OrgUser, targetUserId: string): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.id === targetUserId) return false;
  const [caps, target, units] = await Promise.all([
    capabilitiesOf(actor.id),
    prisma.users.findUnique({ where: { id: targetUserId }, select: { org_unit_id: true } }),
    loadUnits(),
  ]);
  return caps.includes('approve_requests') && !!target?.org_unit_id && scopeOf(units, actor.id).has(target.org_unit_id);
}

/** Everybody who can approve the requests of `userId` besides admins: unit heads up the chain that hold the permission. */
export async function approversOf(userId: string): Promise<{ id: string; email: string }[]> {
  const [{ units, capsOf }, user] = await Promise.all([loadOrg(), prisma.users.findUnique({ where: { id: userId }, select: { org_unit_id: true } })]);
  if (!user?.org_unit_id) return [];
  const byId = new Map(units.map(u => [u.id, u]));
  const heads = new Set<string>();
  for (let cur = byId.get(user.org_unit_id), hops = 0; cur && hops <= units.length; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, hops++) {
    if (cur.head_user_id && cur.head_user_id !== userId && capsOf(cur.head_user_id).includes('approve_requests')) heads.add(cur.head_user_id);
  }
  return heads.size === 0 ? [] : prisma.users.findMany({ where: { id: { in: [...heads] } }, select: { id: true, email: true } });
}

export { withDescendants };

/** What the menus need to know about a person: can they approve their team's requests / run evaluations / evaluate others? */
export async function menuAccessOf(actor: OrgUser): Promise<{ can_approve: boolean; is_hr: boolean; is_evaluator: boolean }> {
  if (actor.role === 'admin') return { can_approve: true, is_hr: true, is_evaluator: true };
  const [caps, units] = await Promise.all([capabilitiesOf(actor.id), loadUnits()]);
  const headsSomething = scopeOf(units, actor.id).size > 0;
  return { can_approve: headsSomething && caps.includes('approve_requests'), is_hr: caps.includes('hr_admin'), is_evaluator: headsSomething && caps.includes('evaluate') };
}
