import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { USERS, type Role } from './constants';

type As = (role: Role) => Promise<APIRequestContext>;

export type OrgIds = { headquarters: string; sales: string; dev: string; positions: Record<string, string> };

/**
 *  本社   管理者 (部長), 経理 (人事)
 *   ├─ 営業部   佐藤 (課長), 田中 (メンバー), 鈴木 (メンバー)
 *   └─ 開発部   山田 (部長)
 *  Placements come from each person's 役職 in each 部署; there is no separate "head".
 */
export async function buildOrg(as: As): Promise<OrgIds> {
  const admin = await as('admin');
  expect((await admin.post('/api/org/positions/defaults')).status()).toBe(200);
  const hr = await admin.post('/api/org/positions', { data: { name: '人事', level: 15, permissions: ['hr_admin'] } });
  expect(hr.status()).toBe(201);
  const listed = await (await admin.get('/api/org')).json();
  const positions: Record<string, string> = Object.fromEntries(listed.positions.map((p: any) => [p.name, p.id]));

  const unit = async (name: string, parent_id: string | null) => {
    const res = await admin.post('/api/org/units', { data: { name, parent_id } });
    expect(res.status()).toBe(201);
    return (await res.json()).id as string;
  };
  const headquarters = await unit('本社', null);
  const sales = await unit('営業部', headquarters);
  const dev = await unit('開発部', headquarters);

  const place = async (role: Role, unitId: string, position: string | null) => putMemberships(admin, USERS[role].id, [{ unit_id: unitId, position_id: position ? positions[position] : null }]);
  await place('admin', headquarters, '部長');
  await place('sato', sales, '課長');
  await place('tanaka', sales, 'メンバー');
  await place('suzuki', sales, 'メンバー');
  await place('yamada', dev, '部長');
  await place('keiri', headquarters, '人事');
  return { headquarters, sales, dev, positions };
}

/** Sets every 所属 of a person: [{ unit_id, position_id }]. */
export async function putMemberships(admin: APIRequestContext, userId: string, memberships: { unit_id: string; position_id: string | null }[]) {
  const res = await admin.put(`/api/org/members/${userId}`, { data: { memberships } });
  expect(res.status()).toBe(200);
}

export const CRITERIA = [
  { name: '業務の成果', description: '成果', weight: 3 },
  { name: '協調性', description: null, weight: 1 },
];

/** Create + open a period; returns its id. */
export async function openCycle(hr: APIRequestContext, name = '2026年度 上期') {
  const made = await hr.post('/api/evaluations/cycles', { data: { name, period_start: '2026-04-01', period_end: '2026-09-30', criteria: CRITERIA } });
  expect(made.status()).toBe(201);
  const id = (await made.json()).id as string;
  expect((await hr.post(`/api/evaluations/cycles/${id}/open`)).status()).toBe(200);
  return id;
}

/** The evaluation form of `role` in a period. */
export async function formOf(hr: APIRequestContext, cycleId: string, role: Role) {
  const rows = (await (await hr.get(`/api/evaluations?scope=all&cycle_id=${cycleId}`)).json()).items as { id: string; user: { id: string } }[];
  return rows.find(r => r.user.id === USERS[role].id)!.id;
}

export async function criteriaOf(hr: APIRequestContext, cycleId: string) {
  return (await (await hr.get(`/api/evaluations/cycles/${cycleId}`)).json()).criteria as { id: string; name: string }[];
}

export const scoresFor = (criteria: { id: string }[], score: number) => criteria.map(c => ({ criterion_id: c.id, score, comment: null }));
