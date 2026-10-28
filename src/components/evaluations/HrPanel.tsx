'use client';
import { useCallback, useEffect, useState } from 'react';
import { Notice, api, btn, btnPrimary } from '@/components/work/ui';
import CycleEditor, { blankCycle, draftFromCycle, type CycleDraft } from './CycleEditor';
import EvaluationList from './EvaluationList';
import { CYCLE_LABEL, type Cycle } from './types';

const ERRORS: Record<string, string> = { no_criteria: '評価項目がありません', not_draft: '開始前の期間だけ変更できます', unfinalized: '確定していない評価があります' };

// 人事の画面: 評価期間をつくる → 開始する → 進み具合を見て確定する → 終了する
export default function HrPanel() {
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [editing, setEditing] = useState<CycleDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => { const r = await fetch('/api/evaluations/cycles'); if (r.ok) setCycles((await r.json()).items); }, []);
  useEffect(() => { load(); }, [load]);
  const bump = () => { load(); setRefresh(n => n + 1); };

  async function edit(c: Cycle) {
    const res = await fetch(`/api/evaluations/cycles/${c.id}`);
    if (res.ok) setEditing(draftFromCycle(await res.json()));
  }
  async function act(c: Cycle, path: 'open' | 'close' | '', method: string, body: unknown, ok: string) {
    const res = await api(`/api/evaluations/cycles/${c.id}${path ? `/${path}` : ''}`, method, body);
    if (res.ok) { setMsg({ type: 'success', text: ok }); if (path !== '') setSelected(c.id); bump(); return; }
    const e = await res.json().catch(() => ({}));
    if (e.error === 'unfinalized' && confirm(`確定していない評価が${e.count}件あります。このまま終了しますか？（未確定の人には結果が出ません）`)) return act(c, path, method, { force: true }, ok);
    setMsg({ type: 'error', text: ERRORS[e.error] ?? '処理できませんでした' });
  }

  if (!cycles) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const current = cycles.find(c => c.id === selected);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-xs text-gray-500">評価期間を作り、開始すると全員分の評価票ができます。評価者は部署長から自動で決まります（個別に変更もできます）。</p>
        <button className={btnPrimary} onClick={() => setEditing(blankCycle())}>＋ 評価期間を作成</button>
      </div>
      <Notice msg={msg} />
      {cycles.length === 0 && <p className="text-sm text-gray-400">評価期間がありません</p>}
      <ul className="space-y-2">
        {cycles.map(c => (
          <li key={c.id} className={`rounded-xl border bg-white p-3 ${selected === c.id ? 'border-blue-300' : 'border-gray-200'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{c.name}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{CYCLE_LABEL[c.status]}</span>
              <span className="text-xs text-gray-500">{c.period_start} 〜 {c.period_end} ・ 項目{c.criteria_count}</span>
              <div className="flex-1" />
              {c.status === 'draft' && <>
                <button className="text-sm text-blue-600 hover:underline" onClick={() => edit(c)}>編集</button>
                <button className="text-sm text-red-600 hover:underline" onClick={() => confirm('削除しますか？') && act(c, '', 'DELETE', undefined, '削除しました')}>削除</button>
                <button className={btnPrimary} onClick={() => confirm('開始すると全員分の評価票を作り、全員に通知します。開始しますか？') && act(c, 'open', 'POST', undefined, '評価期間を開始しました')}>開始する</button>
              </>}
              {c.status !== 'draft' && <button className={btn} onClick={() => setSelected(selected === c.id ? null : c.id)}>{selected === c.id ? '閉じる' : '進み具合を見る'}</button>}
              {c.status === 'open' && <button className={btn} onClick={() => act(c, 'close', 'POST', {}, '評価期間を終了しました')}>終了する</button>}
            </div>
            {c.progress && c.status !== 'draft' && (
              <p className="mt-1.5 text-xs text-gray-500">{c.progress.total}人中 ・ 自己評価 {c.progress.self} ・ 上長評価 {c.progress.manager} ・ 確定 {c.progress.finalized}</p>
            )}
          </li>
        ))}
      </ul>
      {current && <section aria-label={`${current.name}の評価一覧`} className="space-y-2"><h3 className="text-sm font-semibold text-gray-700">{current.name} の評価一覧</h3><EvaluationList scope="all" cycleId={current.id} refreshKey={refresh} onChanged={bump} /></section>}
      {editing && <CycleEditor initial={editing} onClose={() => setEditing(null)} onSaved={t => { setEditing(null); setMsg({ type: 'success', text: t }); bump(); }} />}
    </div>
  );
}
