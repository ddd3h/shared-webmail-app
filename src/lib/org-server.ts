// DB side of the organisation: who has which permission, and for whom.
// A person belongs to 部署 with a 役職 in each (org_memberships). The permissions of a 役職 apply inside the 部署 it is held in, and below it.
import { prisma } from '@/lib/db';
import { holdersOver, scopeFor, withDescendants, type Capability, type Membership, type Unit, isCapability } from '@/lib/org';

export type OrgUser = { id: string; role: string };
type Loaded = { units: Unit[]; memberships: Membership[]; capsOf: (userId: string) => Capability[] };

export async function loadUnits(): Promise<Unit[]> {
  return prisma.org_units.findMany({ select: { id: true, parent_id: true } });
}

const toCaps = (permissions: string[] | undefined): Capability[] => (permissions ?? []).filter(isCapability);

type Row = { user_id: string; unit_id: string; position: { level: number; permissions: string[] } | null };
const toMembership = (r: Row): Membership => ({ user_id: r.user_id, unit_id: r.unit_id, level: r.position?.level ?? 0, caps: toCaps(r.position?.permissions) });
const MEMBERSHIP_SELECT = { user_id: true, unit_id: true, position: { select: { level: true, permissions: true } } } as const;

// 人事担当 (the flag) can run evaluations for the whole company, whatever their 役職 or unit
const withHr = (caps: Capability[], isHr: boolean): Capability[] => (isHr && !caps.includes('hr_admin') ? [...caps, 'hr_admin'] : caps);
const union = (ms: Membership[]): Capability[] => [...new Set(ms.flatMap(m => m.caps))];

/** Permissions a person holds anywhere (the union over their 部署). Admins are handled separately: they can do everything. */
export async function capabilitiesOf(userId: string): Promise<Capability[]> {
  const [u, rows] = await Promise.all([
    prisma.users.findUnique({ where: { id: userId }, select: { is_hr: true } }),
    prisma.org_memberships.findMany({ where: { user_id: userId }, select: MEMBERSHIP_SELECT }),
  ]);
  return withHr(union(rows.map(toMembership)), !!u?.is_hr);
}

/** Loads units, everybody's 所属 and permissions once, for code that needs to ask about many people. */
export async function loadOrg(): Promise<Loaded> {
  const [units, users, rows] = await Promise.all([
    loadUnits(),
    prisma.users.findMany({ select: { id: true, role: true, is_hr: true } }),
    prisma.org_memberships.findMany({ select: MEMBERSHIP_SELECT }),
  ]);
  const memberships = rows.map(toMembership);
  const byUser = new Map<string, Membership[]>();
  for (const m of memberships) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m]);
  const caps = new Map(users.map(u => [u.id, u.role === 'admin' ? (['approve_requests', 'evaluate', 'hr_admin'] as Capability[]) : withHr(union(byUser.get(u.id) ?? []), u.is_hr)]));
  return { units, memberships, capsOf: id => caps.get(id) ?? [] };
}

/** True for admins, or for people holding `cap` in some 部署. No scope check: use canReviewUser for per-person questions. */
export async function hasCapability(actor: OrgUser, cap: Capability): Promise<boolean> {
  return actor.role === 'admin' || (await capabilitiesOf(actor.id)).includes(cap);
}

/** Users the actor may act on with `cap`: members of the 部署 where their 役職 grants it (and below). Never includes the actor. */
export async function usersInScope(actor: OrgUser, cap: Capability): Promise<string[]> {
  const [units, mine] = await Promise.all([loadUnits(), prisma.org_memberships.findMany({ where: { user_id: actor.id }, select: MEMBERSHIP_SELECT })]);
  const scope = scopeFor(units, mine.map(toMembership), actor.id, cap);
  if (scope.size === 0) return [];
  const rows = await prisma.org_memberships.findMany({ where: { unit_id: { in: [...scope] }, user_id: { not: actor.id } }, select: { user_id: true }, distinct: ['user_id'] });
  return rows.map(r => r.user_id);
}

/** The 部署 (with everything below them) where the actor's 役職 grants `cap`. Admins are not special-cased: ask isAdmin first. */
export async function unitsInScope(actor: OrgUser, cap: Capability): Promise<Set<string>> {
  const [units, mine] = await Promise.all([loadUnits(), prisma.org_memberships.findMany({ where: { user_id: actor.id }, select: MEMBERSHIP_SELECT })]);
  return scopeFor(units, mine.map(toMembership), actor.id, cap);
}

/** The 部署 a person may claim for: the ones they belong to. */
export async function unitsOf(userId: string): Promise<{ id: string; name: string; position: string | null }[]> {
  const rows = await prisma.org_memberships.findMany({ where: { user_id: userId }, select: { unit: { select: { id: true, name: true, sort: true } }, position: { select: { name: true } } } });
  return rows.sort((a, b) => a.unit.sort - b.unit.sort || a.unit.name.localeCompare(b.unit.name)).map(r => ({ id: r.unit.id, name: r.unit.name, position: r.position?.name ?? null }));
}

/** Which 部署 a request is for: the one named (it must be one of the person's), the only one they have, or "not chosen" when they have none.
 *  A person in several 部署 has to say which. */
export async function resolveUnit(userId: string, requested: string | null | undefined): Promise<{ ok: true; unit_id: string | null } | { ok: false; error: 'unit_required' | 'invalid_unit' }> {
  const mine = await unitsOf(userId);
  if (requested) return mine.some(u => u.id === requested) ? { ok: true, unit_id: requested } : { ok: false, error: 'invalid_unit' };
  if (mine.length === 0) return { ok: true, unit_id: null };
  return mine.length === 1 ? { ok: true, unit_id: mine[0].id } : { ok: false, error: 'unit_required' };
}

/** May `actor` approve/reject a request of `request.user_id` made for the 部署 `request.unit_id`? That 部署 decides: the actor's 役職 has to allow approving
 *  in it (or above it). A request with no 部署 chosen (an older one) follows the rule for the person: any of their 部署 will do. */
export async function canReviewRequest(actor: OrgUser, request: { user_id: string; unit_id: string | null }): Promise<boolean> {
  if (!request.unit_id) return canReviewUser(actor, request.user_id);
  if (actor.role === 'admin') return true;
  if (actor.id === request.user_id) return false;
  if (await isExecutive(request.user_id)) return isExecutive(actor.id); // a 役員's request is decided by another 役員, whatever the 部署
  const named = await designatedIds(request.unit_id, 'expense'); // a 部署 that named its approvers: only they (and admins) decide
  if (named.length > 0) return named.includes(actor.id);
  return (await unitsInScope(actor, 'approve_requests')).has(request.unit_id);
}

/** May `actor` approve/reject the request of `targetUserId`? Admins always (self-approval is checked by the route). The person is in
 *  a 部署 where the actor's 役職 allows approving, or below it. */
export async function canReviewUser(actor: OrgUser, targetUserId: string): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.id === targetUserId) return false;
  if (await isExecutive(targetUserId)) return isExecutive(actor.id);
  const [units, mine, theirs] = await Promise.all([
    loadUnits(),
    prisma.org_memberships.findMany({ where: { user_id: actor.id }, select: MEMBERSHIP_SELECT }),
    prisma.org_memberships.findMany({ where: { user_id: targetUserId }, select: { unit_id: true } }),
  ]);
  const scope = scopeFor(units, mine.map(toMembership), actor.id, 'approve_requests');
  return theirs.some(t => scope.has(t.unit_id));
}

// ---- 部署ごとに指定する人（経費の承認者・評価者） ----
export type DesignationKind = 'expense' | 'evaluation';

/** The people a 部署 named for `kind`, in the order they were named. Empty = nobody named: the 役職 permissions decide. */
export async function designatedIds(unitId: string, kind: DesignationKind): Promise<string[]> {
  const rows = await prisma.org_unit_designations.findMany({ where: { unit_id: unitId, kind }, orderBy: [{ created_at: 'asc' }, { user_id: 'asc' }], select: { user_id: true } });
  return rows.map(r => r.user_id);
}
/** The 部署 where `userId` is named for `kind`. */
export async function designatedUnitsOf(userId: string, kind: DesignationKind): Promise<string[]> {
  return (await prisma.org_unit_designations.findMany({ where: { user_id: userId, kind }, select: { unit_id: true } })).map(r => r.unit_id);
}
/** Every 部署 that named somebody for `kind`. */
export async function unitsWithDesignees(kind: DesignationKind): Promise<string[]> {
  return (await prisma.org_unit_designations.findMany({ where: { kind }, select: { unit_id: true }, distinct: ['unit_id'] })).map(r => r.unit_id);
}

/** 役員: their requests are approved by other 役員 (and admins), never by the head of a 部署. */
export async function isExecutive(userId: string): Promise<boolean> {
  return (await prisma.users.count({ where: { id: userId, worker_type: 'executive' } })) > 0;
}
export const executiveIds = async (): Promise<string[]> => (await prisma.users.findMany({ where: { worker_type: 'executive' }, select: { id: true } })).map(u => u.id);

/** Everybody who can approve the requests of `userId` besides admins: people holding the permission in the 部署 the request is for (or, when not
 *  given, in any 部署 of the person), or above it. For a 役員 it is the other 役員 instead. */
export async function approversOf(userId: string, unitId: string | null = null): Promise<{ id: string; email: string }[]> {
  if (await isExecutive(userId)) return prisma.users.findMany({ where: { worker_type: 'executive', id: { not: userId } }, select: { id: true, email: true } });
  if (unitId) {
    const all = await designatedIds(unitId, 'expense');
    if (all.length > 0) { // the 部署 named its approvers (and if the only one named is the person themselves, the admins decide)
      const named = all.filter(id => id !== userId);
      return named.length === 0 ? [] : prisma.users.findMany({ where: { id: { in: named } }, select: { id: true, email: true } });
    }
  }
  const [{ units, memberships }, mine] = await Promise.all([loadOrg(), unitId ? Promise.resolve([{ unit_id: unitId }]) : prisma.org_memberships.findMany({ where: { user_id: userId }, select: { unit_id: true } })]);
  const ids = new Set<string>();
  for (const { unit_id } of mine) for (const id of holdersOver(units, memberships, unit_id, 'approve_requests')) if (id !== userId) ids.add(id);
  return ids.size === 0 ? [] : prisma.users.findMany({ where: { id: { in: [...ids] } }, select: { id: true, email: true } });
}

export { withDescendants };

/** What the menus need to know about a person: can they approve their team's requests / run evaluations / evaluate others? */
export async function menuAccessOf(actor: OrgUser): Promise<{ can_approve: boolean; is_hr: boolean; is_evaluator: boolean }> {
  if (actor.role === 'admin') return { can_approve: true, is_hr: true, is_evaluator: true };
  const caps = await capabilitiesOf(actor.id);
  const named = await designatedUnitsOf(actor.id, 'expense');
  const namedEval = await designatedUnitsOf(actor.id, 'evaluation');
  return { can_approve: caps.includes('approve_requests') || named.length > 0 || (await isExecutive(actor.id)), is_hr: caps.includes('hr_admin'), is_evaluator: caps.includes('evaluate') || namedEval.length > 0 };
}
