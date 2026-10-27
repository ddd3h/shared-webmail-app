'use client';
import { useEffect, useState } from 'react';
import MyExpenses from '@/components/expenses/MyExpenses';
import AdminExpenses from '@/components/expenses/AdminExpenses';

type Me = { id: string; name: string; role: string; is_finance?: boolean };

export default function ExpensesPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<'mine' | 'admin'>('mine');
  const [tripId, setTripId] = useState<string | undefined>();
  useEffect(() => { setTripId(new URLSearchParams(window.location.search).get('trip') || undefined); }, []);
  useEffect(() => { fetch('/api/work/me').then(r => r.json()).then(setMe).catch(() => {}); }, []);
  if (!me) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const tabs = [{ k: 'mine' as const, l: '自分の申請' }, ...(me.is_finance ? [{ k: 'admin' as const, l: me.role === 'admin' ? '承認・返金' : '全員の申請・返金' }] : [])];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">経費申請</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">経費の申請と承認、立替金の返金</p>
      </div>
      <div className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
        ))}
      </div>
      {tab === 'mine' ? <MyExpenses initialTripId={tripId} /> : <AdminExpenses meId={me.id} canReview={me.role === 'admin'} />}
    </div>
  );
}
