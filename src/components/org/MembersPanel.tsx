'use client';
import { useState } from 'react';
import { Notice, btn, inp } from '@/components/work/ui';
import { flattenTree, type OrgData, type OrgMember, type OrgMembership } from './types';
import { putMemberships } from './memberships';

// 誰がどの部署で、どの役職か（システム管理者）。1人が複数の部署に、部署ごとに別の役職で所属できます。選ぶとすぐ保存されます。
export default function MembersPanel({ data, onChanged }: { data: OrgData; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // what was just chosen, shown at once and used as the base of the next change (so two quick changes can't undo each other)
  const [local, setLocal] = useState<Record<string, OrgMembership[]>>({});
  const units = flattenTree(data.units);
  const current = (m: OrgMember) => local[m.id] ?? m.memberships;

  async function save(m: OrgMember, next: OrgMembership[]) {
    setLocal(l => ({ ...l, [m.id]: next }));
    const ok = await putMemberships(m.id, next);
    setMsg(ok ? { type: 'success', text: `${m.name} さんを更新しました` } : { type: 'error', text: '更新できませんでした' });
    onChanged();
  }
  const setAt = (m: OrgMember, i: number, patch: Partial<OrgMembership>) => save(m, current(m).map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addFor = (m: OrgMember) => {
    const used = new Set(current(m).map(x => x.unit_id));
    const free = units.find(({ unit }) => !used.has(unit.id));
    if (free) void save(m, [...current(m), { unit_id: free.unit.id, position_id: null }]);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">部署と役職を選ぶとすぐに反映されます。1人を複数の部署に入れられ、役職は部署ごとに決めます（この部署では班長、あの部署では部長）。部署ごとにまとめて入れるときは「部署」のタブが便利です。評価者は部署ごとに決まります。</p>
      <Notice msg={msg} />
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">名前</th><th className="px-3 py-2 text-left">所属（部署と、その部署での役職）</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {data.members.map(m => {
              const list = current(m);
              const used = new Set(list.map(x => x.unit_id));
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 align-top"><div className="font-medium text-gray-900">{m.name}{m.role === 'admin' && <span className="ml-1 rounded-sm bg-blue-50 px-1 text-[10px] text-blue-700">システム管理者</span>}</div><div className="text-xs text-gray-400">{m.email}</div></td>
                  <td className="px-3 py-2">
                    <div className="space-y-1.5">
                      {list.length === 0 && <span className="text-xs text-gray-400">（どの部署にも所属していません）</span>}
                      {list.map((x, i) => (
                        <div key={x.unit_id} className="flex flex-wrap items-center gap-2">
                          <select className={`${inp} min-w-36 max-w-52`} aria-label={`${m.name}の部署${i + 1}`} value={x.unit_id} onChange={e => setAt(m, i, { unit_id: e.target.value })}>
                            {units.filter(({ unit }) => unit.id === x.unit_id || !used.has(unit.id)).map(({ unit, depth }) => <option key={unit.id} value={unit.id}>{'　'.repeat(depth)}{unit.name}</option>)}
                          </select>
                          <select className={`${inp} min-w-28 max-w-40`} aria-label={`${m.name}の部署${i + 1}での役職`} value={x.position_id ?? ''} onChange={e => setAt(m, i, { position_id: e.target.value || null })}>
                            <option value="">（役職なし）</option>
                            {data.positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <button className="text-xs text-red-600 hover:underline" aria-label={`${m.name}の部署${i + 1}から外す`} onClick={() => save(m, list.filter((_, j) => j !== i))}>外す</button>
                        </div>
                      ))}
                      {used.size < units.length && <button className={`${btn} !px-2 !py-1 text-xs`} aria-label={`${m.name}の所属を追加`} onClick={() => addFor(m)}>＋ 部署を追加</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
