'use client';
import { useCallback, useEffect, useState } from 'react';
import MyTrips from '@/components/trips/MyTrips';
import AdminTrips from '@/components/trips/AdminTrips';
import AllowanceSettings from '@/components/trips/AllowanceSettings';
import type { RateType } from '@/components/trips/shared';

type Me = { id: string; name: string; role: string; is_finance?: boolean };
type TabKey = 'mine' | 'admin' | 'settings';

export default function TripsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [types, setTypes] = useState<RateType[] | null>(null);
  const [tab, setTab] = useState<TabKey>('mine');

  const loadTypes = useCallback(async () => {
    const res = await fetch('/api/trips/allowance-types');
    if (res.ok) setTypes((await res.json()).items);
  }, []);
  useEffect(() => { fetch('/api/work/me').then(r => r.json()).then(setMe).catch(() => {}); loadTypes(); }, [loadTypes]);

  if (!me || !types) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const tabs: { k: TabKey; l: string }[] = [{ k: 'mine', l: '自分の出張' }, ...(me.is_finance ? [{ k: 'admin' as const, l: me.role === 'admin' ? '承認' : '全員の出張' }, { k: 'settings' as const, l: '手当の設定' }] : [])];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">出張申請</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">出張の申請と承認、日当・加算金の計算、出張中の経費の紐付け</p>
      </div>
      <div className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200 scrollbar-none">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
        ))}
      </div>
      {tab === 'mine' && <MyTrips types={types} />}
      {tab === 'admin' && <AdminTrips meId={me.id} types={types} canReview={me.role === 'admin'} />}
      {tab === 'settings' && <AllowanceSettings onChanged={loadTypes} />}
    </div>
  );
}
