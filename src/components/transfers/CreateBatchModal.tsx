'use client';
import { useState } from 'react';
import { Modal, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';
import { todayJst } from '@/components/payments/shared';

type Problem = { id: string; label: string; reason: string };

// Asks for the 振込指定日 and makes the 全銀 file. If any line can't go into the file, nothing is made and every problem is listed.
export default function CreateBatchModal({ kind, ids, total, hasBatched, onClose, onCreated }: {
  kind: 'payment' | 'payroll'; ids: string[]; total: number; hasBatched: boolean; onClose: () => void; onCreated: (batchId: string, fileName: string) => void;
}) {
  const [date, setDate] = useState(todayJst());
  const [category, setCategory] = useState<'11' | '12'>('11');
  const [force, setForce] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(''); setProblems([]);
    try {
      const res = await api('/api/transfers/batches', 'POST', { kind, ids, transfer_date: date, force, ...(kind === 'payroll' ? { category } : {}) });
      if (res.ok) { const b = await res.json(); onCreated(b.id, b.file_name); return; }
      const e = await res.json().catch(() => ({}));
      if (e.problems) setProblems(e.problems);
      else if (e.error === 'zengin_settings') setError(e.message);
      else setError('全銀データを作れませんでした。振込指定日は今日から60日以内で指定してください');
    } finally { setBusy(false); }
  }

  return (
    <Modal title="全銀データを作成" onClose={onClose}>
      <p className="text-sm text-gray-700 mb-3">{ids.length}件・合計 <b className="tabular-nums">{yen(total)}</b> の{kind === 'payroll' ? '給与' : '総合'}振込データを作ります。</p>
      <div className="space-y-3">
        <div><label className="text-xs text-gray-600">振込指定日（銀行が振り込む日）</label><input type="date" className={inp} value={date} min={todayJst()} onChange={e => setDate(e.target.value)} /></div>
        {kind === 'payroll' && (
          <div><label className="text-xs text-gray-600">種別</label>
            <select className={inp} value={category} onChange={e => setCategory(e.target.value as '11' | '12')}><option value="11">給与振込</option><option value="12">賞与振込</option></select></div>
        )}
        {hasBatched && (
          <label className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <input type="checkbox" className="mt-0.5" checked={force} onChange={e => setForce(e.target.checked)} />
            <span>作成済みの全銀データに含まれる分も含める（銀行にまだ送っていない場合だけ。二重に振り込まないよう注意してください）</span>
          </label>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {problems.length > 0 && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 space-y-1" role="alert">
            <p className="font-medium">次の{problems.length}件を直すまで、全銀データは作れません（一部だけのデータは作りません）</p>
            <ul className="list-disc pl-5 text-xs space-y-0.5">{problems.map(p => <li key={p.id}><b>{p.label}</b>: {p.reason}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={onClose}>閉じる</button><button className={btnPrimary} disabled={busy || !date} onClick={create}>{busy ? '作成中…' : '作成する'}</button></div>
    </Modal>
  );
}
