'use client';
import { useEffect, useState } from 'react';
import EvaluationList from '@/components/evaluations/EvaluationList';
import HrPanel from '@/components/evaluations/HrPanel';

type Me = { is_hr: boolean; is_evaluator: boolean };
type TabKey = 'mine' | 'team' | 'hr';

export default function EvaluationsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<TabKey>('mine');
  useEffect(() => { fetch('/api/work/me').then(r => r.json()).then(setMe).catch(() => {}); }, []);
  if (!me) return <p className="text-sm text-gray-400">読み込み中…</p>;

  const tabs: { k: TabKey; l: string }[] = [{ k: 'mine', l: '自分の評価' }, ...(me.is_evaluator ? [{ k: 'team' as const, l: 'メンバーの評価' }] : []), ...(me.is_hr ? [{ k: 'hr' as const, l: '評価の運用' }] : [])];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">人事評価</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">自己評価 → 上長の評価 → 人事が確定、の順で進みます。結果は確定後に本人へ公開されます</p>
      </div>
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none">
          {tabs.map(t => <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>)}
        </div>
      )}
      <div key={tab} className="tab-fade">
        {tab === 'mine' && <EvaluationList scope="mine" />}
        {tab === 'team' && <EvaluationList scope="team" />}
        {tab === 'hr' && <HrPanel />}
      </div>
    </div>
  );
}
