'use client';
import { useState } from 'react';
import { Notice, api, inp } from '@/components/work/ui';
import { flattenTree, type OrgData } from './types';

type Kind = 'expense' | 'evaluation';
const KINDS: { k: Kind; label: string; none: string; help: string }[] = [
  { k: 'expense', label: '経費の承認者', none: '指定なし（役職の権限で決まる）', help: '指定すると、この部署の経費は、指定した人（と管理者）だけが承認します' },
  { k: 'evaluation', label: '評価者', none: '指定なし（役職で決まる）', help: '指定すると、評価の開始時に、この部署のメンバーの評価者になります（複数のときは上の人。本人の評価は次の人）' },
];

// 部署ごとに、経費の承認者と評価者を指定する（管理者・人事）。指定がなければ、役職の権限で決まる。
export default function DesignationsPanel({ data, onChanged }: { data: OrgData; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const tree = flattenTree(data.units);
  const named = (unitId: string, kind: Kind) => (data.designations ?? []).filter(d => d.unit_id === unitId && d.kind === kind).map(d => d.user_id);
  const nameOf = (id: string) => data.members.find(m => m.id === id)?.name ?? '（不明）';

  async function save(unitId: string, kind: Kind, ids: string[]) {
    const res = await api(`/api/org/units/${unitId}/designations`, 'PUT', { kind, user_ids: ids });
    setMsg(res.ok ? { type: 'success', text: '保存しました' } : { type: 'error', text: '保存できませんでした' });
    if (res.ok) onChanged();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">部署ごとに、経費を承認する人と、人事評価の評価者を決めます。指定しない部署は、役職の権限（承認・評価）で決まります。管理者と人事が設定できます。</p>
      <Notice msg={msg} />
      {tree.length === 0 && <p className="text-sm text-gray-400">部署がありません</p>}
      <ul className="space-y-2">
        {tree.map(({ unit, depth }) => (
          <li key={unit.id} aria-label={unit.name} style={{ marginLeft: `${Math.min(depth, 5) * 1.25}rem` }} className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
            <div className="text-sm font-semibold text-gray-900">{unit.name}</div>
            {KINDS.map(({ k, label, none, help }) => {
              const ids = named(unit.id, k);
              const key = `${unit.id}:${k}`;
              return (
                <div key={k} className="space-y-1.5" data-testid={`designation-${k}`}>
                  <div className="text-xs font-medium text-gray-700">{label}<span className="ml-2 font-normal text-gray-400">{help}</span></div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ids.length === 0 && <span className="text-xs text-gray-500">{none}</span>}
                    {ids.map((id, i) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-800">
                        {k === 'evaluation' && ids.length > 1 && <span className="text-blue-400">{i + 1}.</span>}{nameOf(id)}
                        <button className="text-blue-400 hover:text-red-600" aria-label={`${unit.name}の${label}から${nameOf(id)}を外す`} onClick={() => save(unit.id, k, ids.filter(x => x !== id))}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <select className={`${inp} max-w-52`} aria-label={`${unit.name}の${label}に加える人`} value={pick[key] ?? ''} onChange={e => setPick(p => ({ ...p, [key]: e.target.value }))}>
                      <option value="">人を選ぶ</option>
                      {data.members.filter(m => !ids.includes(m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button className="text-sm text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline" disabled={!pick[key]} onClick={async () => { await save(unit.id, k, [...ids, pick[key]]); setPick(p => ({ ...p, [key]: '' })); }}>＋ 加える</button>
                  </div>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
