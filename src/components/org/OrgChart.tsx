'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { flattenTree, type OrgData } from './types';
import { membersOfUnit } from './memberships';

// The diagram (cards that can be dragged, lines that follow) is loaded only when it is shown: it is a big piece of code.
const OrgDiagram = dynamic(() => import('./OrgDiagram'), { ssr: false, loading: () => <p className="text-sm text-gray-400">組織図を読み込んでいます…</p> });

type Mode = 'diagram' | 'list';

// The organisation chart everybody can see. As a diagram (the default) every 部署 is a card placed freely; as a list, each 部署 with its people.
export default function OrgChart({ data, onChanged }: { data: OrgData; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('diagram');
  useEffect(() => { try { const m = localStorage.getItem('org-chart-mode'); if (m === 'list' || m === 'diagram') setMode(m); } catch { /* private mode etc. */ } }, []);
  const choose = (m: Mode) => { setMode(m); try { localStorage.setItem('org-chart-mode', m); } catch { /* private mode etc. */ } };

  if (data.units.length === 0) return <p className="text-sm text-gray-500">まだ組織が登録されていません。</p>;
  return (
    <div className="space-y-3">
      <div role="group" aria-label="表示" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm">
        {([['diagram', '図'], ['list', '一覧']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => choose(k)} className={`px-4 py-1.5 ${mode === k ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{l}</button>
        ))}
      </div>
      {mode === 'diagram' ? <OrgDiagram data={data} editable={data.me.is_admin} onChanged={onChanged} /> : <OrgList data={data} />}
    </div>
  );
}

// Each 部署 with its members and their 役職 there (the highest first). A person who belongs to several 部署 is listed under each of them.
function OrgList({ data }: { data: OrgData }) {
  const { units, members, positions } = data;
  const positionName = (id: string | null) => positions.find(p => p.id === id)?.name;
  const unassigned = members.filter(m => !m.memberships.some(x => units.some(u => u.id === x.unit_id)));
  return (
    <div className="space-y-3">
      {flattenTree(units).map(({ unit, depth }) => {
        const people = membersOfUnit(data, unit.id);
        return (
          <section key={unit.id} aria-label={unit.name} style={{ marginLeft: `${Math.min(depth, 5) * 1.25}rem` }} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-gray-900">{unit.name}</h3>
              <span className="text-xs text-gray-400">{people.length}人</span>
            </div>
            {people.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {people.map(({ member, position_id }) => (
                  <li key={member.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                    {member.name}{positionName(position_id) && <span className="ml-1 text-gray-400">{positionName(position_id)}</span>}
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
