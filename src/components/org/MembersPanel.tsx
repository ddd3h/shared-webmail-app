'use client';
import { useState } from 'react';
import { Notice, api, inp } from '@/components/work/ui';
import { flattenTree, type OrgData, type OrgMember } from './types';

// 誰がどの部署でどの役職か（システム管理者）。選ぶとすぐ保存されます。
export default function MembersPanel({ data, onChanged }: { data: OrgData; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // what was just chosen, shown at once and used as the base of the next change (so two quick changes can't undo each other)
  const [local, setLocal] = useState<Record<string, Pick<OrgMember, 'org_unit_id' | 'position_id'>>>({});
  const units = flattenTree(data.units);
  const current = (m: OrgMember) => local[m.id] ?? { org_unit_id: m.org_unit_id, position_id: m.position_id };

  async function change(m: OrgMember, patch: Partial<Pick<OrgMember, 'org_unit_id' | 'position_id'>>) {
    const body = { ...current(m), ...patch };
    setLocal(l => ({ ...l, [m.id]: body }));
    const res = await api(`/api/org/members/${m.id}`, 'PUT', body);
    setMsg(res.ok ? { type: 'success', text: `${m.name} さんを更新しました` } : { type: 'error', text: '更新できませんでした' });
    onChanged();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">所属と役職を選ぶとすぐに反映されます。評価者・承認者は、この所属と各部署の部署長から決まります。</p>
      <Notice msg={msg} />
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">名前</th><th className="px-3 py-2 text-left">部署</th><th className="px-3 py-2 text-left">役職</th></tr></thead>
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
