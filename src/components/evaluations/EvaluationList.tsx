'use client';
import { useCallback, useEffect, useState } from 'react';
import EvaluationForm from './EvaluationForm';
import { STAGE_LABEL, STAGE_STYLE, type Row } from './types';

const EMPTY = { mine: '自分の評価はまだありません。評価期間が始まると、ここに自己評価の入力欄が出ます。', team: '評価を担当している人はいません。', all: '評価はまだありません。' };

// A list of evaluation forms (about me / of my team / everybody's) that opens a form on click.
export default function EvaluationList({ scope, cycleId, refreshKey = 0, onChanged }: { scope: 'mine' | 'team' | 'all'; cycleId?: string; refreshKey?: number; onChanged?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/evaluations?scope=${scope}${cycleId ? `&cycle_id=${cycleId}` : ''}`);
    setRows(res.ok ? (await res.json()).items : []);
  }, [scope, cycleId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!rows) return <p className="text-sm text-gray-400">読み込み中…</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-400">{EMPTY[scope]}</p>;
  return (
    <>
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.id}>
            <button onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 bg-white p-3 text-left hover:bg-gray-50">
              <div className="min-w-40 flex-1">
                <div className="text-sm font-medium text-gray-900">{scope === 'mine' ? r.cycle.name : r.user.name}{r.unit && <span className="ml-2 rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] font-normal text-gray-600">{r.unit.name}</span>}</div>
                <div className="text-xs text-gray-500">{scope === 'mine' ? `評価者: ${r.evaluator?.name ?? '未設定'}` : `${r.cycle.name} ・ 評価者: ${r.evaluator?.name ?? '未設定'}`}</div>
              </div>
              {r.grade && <span className="text-lg font-bold text-gray-900" aria-label={`等級 ${r.grade}`}>{r.grade}</span>}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STAGE_STYLE[r.stage]}`}>{STAGE_LABEL[r.stage]}</span>
            </button>
          </li>
        ))}
      </ul>
      {openId && <EvaluationForm id={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); onChanged?.(); }} />}
    </>
  );
}
