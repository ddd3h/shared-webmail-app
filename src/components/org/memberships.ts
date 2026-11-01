import { api } from '@/components/work/ui';
import type { OrgData, OrgMember, OrgMembership } from './types';

/** Saves every 所属 of one person (the list replaces what they had). */
export async function putMemberships(userId: string, memberships: OrgMembership[]): Promise<boolean> {
  return (await api(`/api/org/members/${userId}`, 'PUT', { memberships })).ok;
}

/** The people of a 部署, the highest 役職 first. */
export function membersOfUnit(data: OrgData, unitId: string): { member: OrgMember; position_id: string | null; level: number }[] {
  const level = (id: string | null) => data.positions.find(p => p.id === id)?.level ?? 0;
  return data.members
    .flatMap(member => member.memberships.filter(m => m.unit_id === unitId).map(m => ({ member, position_id: m.position_id, level: level(m.position_id) })))
    .sort((a, b) => b.level - a.level || a.member.name.localeCompare(b.member.name));
}
