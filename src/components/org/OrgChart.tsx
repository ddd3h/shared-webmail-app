'use client';
import { flattenTree, type OrgData } from './types';

// The organisation chart everybody can see: each 部署 with its head and members.
export default function OrgChart({ data }: { data: OrgData }) {
  const { units, members, positions } = data;
  const positionName = (id: string | null) => positions.find(p => p.id === id)?.name;
  const nameOf = (id: string | null) => members.find(m => m.id === id)?.name;
  const unassigned = members.filter(m => !m.org_unit_id || !units.some(u => u.id === m.org_unit_id));

  if (units.length === 0) return <p className="text-sm text-gray-500">まだ組織が登録されていません。</p>;
  return (
    <div className="space-y-3">
      {flattenTree(units).map(({ unit, depth }) => {
        const people = members.filter(m => m.org_unit_id === unit.id);
        return (
          <section key={unit.id} aria-label={unit.name} style={{ marginLeft: `${Math.min(depth, 5) * 1.25}rem` }} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-gray-900">{unit.name}</h3>
              <span className="text-xs text-gray-500">{unit.head_user_id ? `部署長: ${nameOf(unit.head_user_id) ?? '—'}` : '部署長: 未設定'}</span>
              <span className="text-xs text-gray-400">{people.length}人</span>
            </div>
            {people.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {people.map(m => (
                  <li key={m.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                    {m.name}{positionName(m.position_id) && <span className="ml-1 text-gray-400">{positionName(m.position_id)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {unassigned.length > 0 && (
        <section aria-label="未所属" className="rounded-xl border border-dashed border-gray-300 p-3">
          <h3 className="text-sm font-semibold text-gray-600">未所属 <span className="text-xs font-normal text-gray-400">{unassigned.length}人</span></h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">{unassigned.map(m => <li key={m.id} className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-600">{m.name}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
