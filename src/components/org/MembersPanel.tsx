'use client';
import { useState } from 'react';
import { Notice, api, inp } from '@/components/work/ui';
import { flattenTree, type OrgData, type OrgMember } from './types';

// 誰がどの部署でどの役職か（システム管理者）。選ぶとすぐ保存されます。
export default function MembersPanel({ data, onChanged }: { data: OrgData; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // what was just chosen, shown at once and used as the base of the next change (so two quick changes can't undo each other)
  const [local, setLocal] = useState<Record<string, Pick<OrgMember, 'org_unit_id' | 'extra_unit_ids' | 'position_id'>>>({});
  const units = flattenTree(data.units);
  const current = (m: OrgMember) => local[m.id] ?? { org_unit_id: m.org_unit_id, extra_unit_ids: m.extra_unit_ids ?? [], position_id: m.position_id };

  async function change(m: OrgMember, patch: Partial<Pick<OrgMember, 'org_unit_id' | 'extra_unit_ids' | 'position_id'>>) {
    const body = { ...current(m), ...patch };
    // the main 部署 is not a 兼務 as well, and without a main 部署 there is no 兼務 (the server does the same)
    body.extra_unit_ids = body.org_unit_id ? body.extra_unit_ids.filter(id => id !== body.org_unit_id) : [];
    setLocal(l => ({ ...l, [m.id]: body }));
    const res = await api(`/api/org/members/${m.id}`, 'PUT', body);
    setMsg(res.ok ? { type: 'success', text: `${m.name} さんを更新しました` } : { type: 'error', text: '更新できませんでした' });
    onChanged();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">所属と役職を選ぶとすぐに反映されます。「部署」が主所属で、評価者は主所属の部署長から決まります。ほかの部署にも所属するときは「兼務」で選びます（兼務先の部署長も、承認や閲覧の対象にできます）。</p>
      <Notice msg={msg} />
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">名前</th><th className="px-3 py-2 text-left">部署（主所属）</th><th className="px-3 py-2 text-left">兼務</th><th className="px-3 py-2 text-left">役職</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {data.members.map(m => (
              <tr key={m.id}>
                <td className="px-3 py-2"><div className="font-medium text-gray-900">{m.name}{m.role === 'admin' && <span className="ml-1 rounded-sm bg-blue-50 px-1 text-[10px] text-blue-700">システム管理者</span>}</div><div className="text-xs text-gray-400">{m.email}</div></td>
                <td className="px-3 py-2">
                  <select className={`${inp} min-w-36`} aria-label={`${m.name}の部署`} value={current(m).org_unit_id ?? ''} onChange={e => change(m, { org_unit_id: e.target.value || null })}>
                    <option value="">（未所属）</option>
                    {units.map(({ unit, depth }) => <option key={unit.id} value={unit.id}>{'　'.repeat(depth)}{unit.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {current(m).org_unit_id ? (
                    <details className="relative">
                      <summary className="block min-w-28 max-w-52 cursor-pointer list-none truncate whitespace-nowrap rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50" aria-label={`${m.name}の兼務`}>
                        {current(m).extra_unit_ids.length ? current(m).extra_unit_ids.map(id => data.units.find(u => u.id === id)?.name).filter(Boolean).join('・') : 'なし'}
                      </summary>
                      <div className="absolute z-20 mt-1 max-h-60 min-w-48 overflow-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                        {units.filter(({ unit }) => unit.id !== current(m).org_unit_id).map(({ unit, depth }) => (
                          <label key={unit.id} className="flex items-center gap-2 py-1 text-sm text-gray-700" style={{ paddingLeft: `${depth}rem` }}>
                            <input type="checkbox" className="h-4 w-4" checked={current(m).extra_unit_ids.includes(unit.id)}
                              onChange={e => change(m, { extra_unit_ids: e.target.checked ? [...current(m).extra_unit_ids, unit.id] : current(m).extra_unit_ids.filter(id => id !== unit.id) })} />
                            {unit.name}
                          </label>
                        ))}
                      </div>
                    </details>
                  ) : <span className="whitespace-nowrap text-xs text-gray-400">主所属を先に選びます</span>}
                </td>
                <td className="px-3 py-2">
                  <select className={`${inp} min-w-32`} aria-label={`${m.name}の役職`} value={current(m).position_id ?? ''} onChange={e => change(m, { position_id: e.target.value || null })}>
                    <option value="">（なし）</option>
                    {data.positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
