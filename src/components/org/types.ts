import type { Capability } from '@/lib/org';

export type OrgUnit = { id: string; name: string; parent_id: string | null; head_user_id: string | null; sort: number };
export type OrgPosition = { id: string; name: string; level: number; permissions: Capability[] };
export type OrgMember = { id: string; name: string; org_unit_id: string | null; position_id: string | null; can_evaluate: boolean; role?: string; email?: string };
export type OrgData = {
  units: OrgUnit[]; positions: OrgPosition[]; members: OrgMember[];
  me: { id: string; is_admin: boolean; capabilities: Capability[]; headed_unit_ids: string[]; can_year_end?: boolean };
};

/** Units as a tree, in display order: [{ unit, depth }] depth-first. */
export function flattenTree(units: OrgUnit[]): { unit: OrgUnit; depth: number }[] {
  const children = new Map<string | null, OrgUnit[]>();
  const ids = new Set(units.map(u => u.id));
  for (const u of units) {
    const parent = u.parent_id && ids.has(u.parent_id) ? u.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), u]);
  }
  const out: { unit: OrgUnit; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => { for (const u of children.get(parent) ?? []) { out.push({ unit: u, depth }); walk(u.id, depth + 1); } };
  walk(null, 0);
  return out;
}
