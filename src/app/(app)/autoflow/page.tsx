'use client';
import { useEffect, useState } from 'react';
import SettingsPanel from '@/components/autoflow/SettingsPanel';
import PreviewPanel from '@/components/autoflow/PreviewPanel';
import HistoryPanel from '@/components/autoflow/HistoryPanel';
import PlansPanel from '@/components/autoflow/PlansPanel';

type Me = { is_finance: boolean };
type TabKey = 'settings' | 'preview' | 'history' | 'plans';
const TABS: { k: TabKey; l: string }[] = [{ k: 'settings', l: '流れの設定' }, { k: 'preview', l: 'プレビュー' }, { k: 'plans', l: '固定報酬・賞与' }, { k: 'history', l: '送信履歴' }];

export default function AutoflowPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<TabKey>('settings');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { fetch('/api/work/me').then(r => r.json()).then(setMe).catch(() => {}); }, []);

  if (!me) return <p className="text-sm text-gray-400">読み込み中…</p>;
  if (!me.is_finance) return <p className="text-sm text-gray-600">このページは経理担当と管理者だけが使えます。</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">オートフロー</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">業務報告書・経費・振込日を、期限に合わせてMattermostのDMで自動でお知らせし、役員報酬・準業務委託の固定報酬の下書きを作ります</p>
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
        ))}
      </div>
      <div key={tab} className="tab-fade">
        {tab === 'settings' && <SettingsPanel />}
        {tab === 'preview' && <PreviewPanel onSent={() => setRefresh(n => n + 1)} />}
        {tab === 'plans' && <PlansPanel />}
        {tab === 'history' && <HistoryPanel refreshKey={refresh} />}
      </div>
    </div>
  );
}
