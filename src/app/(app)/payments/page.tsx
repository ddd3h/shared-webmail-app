'use client';
import { useCallback, useEffect, useState } from 'react';
import MyPayments from '@/components/payments/MyPayments';
import AdminPayments from '@/components/payments/AdminPayments';
import VendorsPanel from '@/components/payments/VendorsPanel';
import type { Vendor } from '@/components/payments/shared';

type Me = { id: string; name: string; role: string; is_finance?: boolean };
type TabKey = 'mine' | 'vendors' | 'admin';

export default function PaymentsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [tab, setTab] = useState<TabKey>('mine');

  const loadVendors = useCallback(async () => {
    const res = await fetch('/api/payments/vendors');
    if (res.ok) setVendors((await res.json()).items);
  }, []);
  useEffect(() => { fetch('/api/work/me').then(r => r.json()).then(setMe).catch(() => {}); loadVendors(); }, [loadVendors]);

  if (!me || !vendors) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const admin = !!me.is_finance; // administrators and 経理担当 see every request and every vendor
  const tabs: { k: TabKey; l: string }[] = [{ k: 'mine', l: '自分の申請' }, { k: 'vendors', l: '取引先' }, ...(admin ? [{ k: 'admin' as const, l: me.role === 'admin' ? '承認・振込' : '全員の申請・振込' }] : [])];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">振込申請</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">取引先への銀行振込の申請と承認、振込済みの記録</p>
      </div>
      <div className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
        ))}
      </div>
      {tab === 'mine' && <MyPayments vendors={vendors} onVendorsChanged={loadVendors} />}
      {tab === 'vendors' && <VendorsPanel key={String(admin)} admin={admin} onChanged={loadVendors} />}
      {tab === 'admin' && <AdminPayments meId={me.id} onVendorsChanged={loadVendors} canReview={me.role === 'admin'} />}
    </div>
  );
}
