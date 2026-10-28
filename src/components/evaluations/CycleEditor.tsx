'use client';
import { useState } from 'react';
import { Modal, api, btn, btnPrimary, inp } from '@/components/work/ui';
import type { Criterion } from './types';

export type CycleDraft = { id?: string; name: string; period_start: string; period_end: string; criteria: { name: string; description: string; weight: string }[] };

export const blankCycle = (): CycleDraft => ({
  name: '', period_start: '', period_end: '',
  criteria: [{ name: '業務の成果', description: '担当業務で期待された成果を出せたか', weight: '3' }, { name: '協調性', description: 'チームと連携し、周囲に良い影響を与えたか', weight: '2' }, { name: '成長・学習', description: '新しい知識やスキルを身につけたか', weight: '1' }],
});
export const draftFromCycle = (c: { id: string; name: string; period_start: string; period_end: string; criteria: Criterion[] }): CycleDraft => ({
  id: c.id, name: c.name, period_start: c.period_start, period_end: c.period_end,
  criteria: c.criteria.map(k => ({ name: k.name, description: k.description ?? '', weight: String(k.weight) })),
});

// 評価期間と評価項目（重み）を決める。開始前だけ変更できる。
export default function CycleEditor({ initial, onClose, onSaved }: { initial: CycleDraft; onClose: () => void; onSaved: (text: string) => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState('');
  const setCriterion = (i: number, patch: Partial<CycleDraft['criteria'][number]>) => setD({ ...d, criteria: d.criteria.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const valid = d.name.trim() && d.period_start && d.period_end && d.period_start <= d.period_end && d.criteria.length > 0 && d.criteria.every(c => c.name.trim() && Number(c.weight) >= 1);

  async function save() {
    const body = { name: d.name, period_start: d.period_start, period_end: d.period_end, criteria: d.criteria.map(c => ({ name: c.name, description: c.description || null, weight: Number(c.weight) })) };
    const res = d.id ? await api(`/api/evaluations/cycles/${d.id}`, 'PUT', body) : await api('/api/evaluations/cycles', 'POST', body);
    if (res.ok) onSaved('保存しました'); else setError('保存できませんでした。期間・項目・重み（1〜10）を確認してください');
  }

  return (
    <Modal title={d.id ? '評価期間を編集' : '評価期間を作成'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="text-xs text-gray-600">名前</label><input className={inp} placeholder="2026年度 上期" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-600">期間の開始</label><input type="date" className={inp} value={d.period_start} onChange={e => setD({ ...d, period_start: e.target.value })} /></div>
          <div><label className="text-xs text-gray-600">期間の終了</label><input type="date" className={inp} value={d.period_end} onChange={e => setD({ ...d, period_end: e.target.value })} /></div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs text-gray-600">評価項目（重みが大きい項目ほど総合点に強く効きます）</legend>
          {d.criteria.map((c, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-2 space-y-1.5">
              <div className="grid grid-cols-[1fr_4.5rem_auto] gap-2">
                <input className={inp} aria-label={`項目${i + 1}の名前`} placeholder="項目名" value={c.name} onChange={e => setCriterion(i, { name: e.target.value })} />
                <input className={inp} aria-label={`項目${i + 1}の重み`} type="number" min={1} max={10} value={c.weight} onChange={e => setCriterion(i, { weight: e.target.value })} />
                <button className="px-2 text-sm text-red-600" aria-label={`項目${i + 1}を削除`} onClick={() => setD({ ...d, criteria: d.criteria.filter((_, k) => k !== i) })}>削除</button>
              </div>
              <input className={inp} aria-label={`項目${i + 1}の説明`} placeholder="説明（何を見るか）" value={c.description} onChange={e => setCriterion(i, { description: e.target.value })} />
            </div>
          ))}
          <button className="text-sm text-blue-600 hover:underline" onClick={() => setD({ ...d, criteria: [...d.criteria, { name: '', description: '', weight: '1' }] })}>＋ 項目を追加</button>
        </fieldset>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={onClose}>閉じる</button><button className={btnPrimary} disabled={!valid} onClick={save}>保存</button></div>
    </Modal>
  );
}
