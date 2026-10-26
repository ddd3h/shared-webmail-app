'use client';
import { useEffect, useState } from 'react';
import TransferList from '@/components/transfers/TransferList';
import BatchHistory from '@/components/transfers/BatchHistory';
import AccountsReview from '@/components/transfers/AccountsReview';
import ZenginSettingsPanel from '@/components/transfers/ZenginSettingsPanel';

type Me = { id: string; name: string; role: string; is_finance: boolean };
type TabKey = 'payroll' | 'payment' | 'history' | 'accounts' | 'settings';

export default function TransfersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<TabKey>('payroll');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { fetch('/api/work/me').then(r => r.json()).then(setMe).catch(() => {}); }, []);

  if (!me) return <p className="text-sm text-gray-400">読み込み中…</p>;
  if (!me.is_finance) return <p className="text-sm text-gray-600">このページは経理担当と管理者だけが使えます。</p>;
  const tabs: { k: TabKey; l: string }[] = [
    { k: 'payroll', l: '給与の振込' }, { k: 'payment', l: '支払の振込' }, { k: 'history', l: '作成履歴' },
    { k: 'accounts', l: '受取口座の確認' }, { k: 'settings', l: '全銀の設定' },
  ];
  const created = () => setRefresh(n => n + 1);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">振込データ</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">給与・取引先への支払を、全銀フォーマットのファイルにまとめて銀行の一括振込に使います</p>
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
        ))}
      </div>
      {tab === 'payroll' && <TransferList key="payroll" kind="payroll" onCreated={created} />}
      {tab === 'payment' && <TransferList key="payment" kind="payment" onCreated={created} />}
      {tab === 'history' && <BatchHistory refreshKey={refresh} />}
      {tab === 'accounts' && <AccountsReview meId={me.id} />}
      {tab === 'settings' && <ZenginSettingsPanel admin={me.role === 'admin'} />}
    </div>
  );
}
