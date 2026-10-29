'use client';
import { useEffect, useState } from 'react';
import { RULE_LABEL, STAGE_LABEL, jstTime } from './labels';

type Row = { id: string; rule: string; stage: string; title: string; delivered: boolean; created_at: string; user_name: string };

// 自動で送った通知の履歴（新しい順）。Mattermostに届かなかったものは「アプリ内のみ」。
export default function HistoryPanel({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { fetch('/api/autoflow/notices').then(r => r.json()).then(d => setRows(d.items ?? [])).catch(() => setRows([])); }, [refreshKey]);
  if (!rows) return <p className="text-sm text-gray-400">読み込み中…</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-400">まだ自動で送った通知はありません</p>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{['日時', '流れ', '段階', '宛先', '内容', '届き方'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{jstTime(r.created_at)}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{RULE_LABEL[r.rule] ?? r.rule}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{STAGE_LABEL[r.stage] ?? r.stage}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.user_name}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{r.title}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap"><span className={`rounded-sm px-1.5 py-0.5 ${r.delivered ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.delivered ? 'Mattermost' : 'アプリ内のみ'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
