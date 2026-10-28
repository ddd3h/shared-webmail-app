'use client';
import { useCallback, useEffect, useState } from 'react';
import OrgChart from '@/components/org/OrgChart';
import UnitsPanel from '@/components/org/UnitsPanel';
import PositionsPanel from '@/components/org/PositionsPanel';
import MembersPanel from '@/components/org/MembersPanel';
import YearEndPanel from '@/components/org/YearEndPanel';
import type { OrgData } from '@/components/org/types';

type TabKey = 'chart' | 'units' | 'positions' | 'members' | 'yearend';
const TABS: { k: TabKey; l: string; admin?: boolean; yearEnd?: boolean }[] = [
  { k: 'chart', l: '組織図' }, { k: 'units', l: '部署', admin: true }, { k: 'positions', l: '役職と権限', admin: true }, { k: 'members', l: 'メンバー配置', admin: true },
  { k: 'yearend', l: '年末調整', yearEnd: true }, // 経理・人事・管理者
];

export default function OrgPage() {
  const [data, setData] = useState<OrgData | null>(null);
  const [tab, setTab] = useState<TabKey>('chart');
  const load = useCallback(async () => { const r = await fetch('/api/org'); if (r.ok) setData(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const tabs = TABS.filter(t => (!t.admin || data.me.is_admin) && (!t.yearEnd || data.me.can_year_end));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">組織</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">{data.me.is_admin ? '部署・役職・権限を登録します。承認や人事評価の担当は、ここから決まります' : '部署と、所属しているメンバー'}</p>
      </div>
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
          ))}
        </div>
      )}
      <div key={tab} className="tab-fade">
        {tab === 'chart' && <OrgChart data={data} onChanged={load} />}
        {tab === 'units' && <UnitsPanel data={data} onChanged={load} />}
        {tab === 'positions' && <PositionsPanel data={data} onChanged={load} />}
        {tab === 'members' && <MembersPanel data={data} onChanged={load} />}
        {tab === 'yearend' && <YearEndPanel />}
      </div>
    </div>
  );
}
