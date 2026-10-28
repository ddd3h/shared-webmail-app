'use client';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp } from '@/components/work/ui';
import { GRADE_LABEL, gradeFor, totalScore, type Grade } from '@/lib/org';
import ScorePicker from './ScorePicker';
import { STAGE_LABEL, STAGE_STYLE, type Detail } from './types';
import HrActions from './HrActions';

type Draft = Record<string, { score: number | null; comment: string }>;
type Side = 'self' | 'manager';

const ERRORS: Record<string, string> = {
  incomplete: 'すべての項目に1〜5の点数をつけてください', self_not_submitted: '本人の自己評価が提出されてから評価できます', already_submitted: 'すでに提出済みです',
  finalized: 'すでに確定しています', cycle_not_open: 'この評価期間は終了しています',
};

/** Which side of the form this viewer can edit right now, if any. */
function editableSide(d: Detail): Side | null {
  if (d.cycle.status !== 'open' || d.finalized_at) return null;
  if (d.viewer.isSubject && d.stage === 'self') return 'self';
  if (d.viewer.isEvaluator && d.stage === 'manager') return 'manager';
  return null;
}

// One evaluation form: shows what the viewer may see, lets them fill in their side, and (for HR) fix the result.
export default function EvaluationForm({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // `current` says whether this answer is still wanted: a late answer (dev mode asks twice) must not wipe the scores just typed
  const load = useCallback(async (current: () => boolean = () => true) => {
    const res = await fetch(`/api/evaluations/${id}`);
    if (!current()) return;
    if (!res.ok) { setMsg({ type: 'error', text: '評価を表示できません' }); return; }
    const detail: Detail = await res.json();
    if (!current()) return;
    const side = editableSide(detail);
    setD(detail);
    setComment(side === 'self' ? detail.self_comment ?? '' : side === 'manager' ? detail.manager_comment ?? '' : '');
    setDraft(Object.fromEntries(detail.criteria.map(c => [c.id, side === 'manager' ? { score: c.manager_score, comment: c.manager_comment ?? '' } : { score: c.self_score, comment: c.self_comment ?? '' }])));
  }, [id]);
  useEffect(() => { let alive = true; load(() => alive); return () => { alive = false; }; }, [load]);

  const side = d ? editableSide(d) : null;
  async function save(submit: boolean) {
    if (!d || !side) return;
    const scores = d.criteria.map(c => ({ criterion_id: c.id, score: draft[c.id]?.score ?? null, comment: draft[c.id]?.comment || null }));
    const res = await api(`/api/evaluations/${id}/${side}`, 'PUT', { scores, comment: comment || null, submit });
    if (res.ok) { setMsg({ type: 'success', text: submit ? '提出しました' : '下書きを保存しました' }); onChanged(); if (submit) await load(); }
    else { const e = await res.json().catch(() => ({})); setMsg({ type: 'error', text: ERRORS[e.error] ?? e.message ?? '保存できませんでした' }); }
  }
  const setScore = (cid: string, score: number) => setDraft(x => ({ ...x, [cid]: { ...x[cid], score } }));
  const setCriterionComment = (cid: string, text: string) => setDraft(x => ({ ...x, [cid]: { ...x[cid], comment: text } }));

  if (!d) return <Modal title="人事評価" onClose={onClose}><p className="text-sm text-gray-400">{msg?.text ?? '読み込み中…'}</p></Modal>;
  const preview = totalScore(d.criteria, d.criteria.map(c => ({ criterion_id: c.id, manager_score: side === 'manager' ? draft[c.id]?.score ?? null : c.manager_score })));
  return (
    <Modal title={`${d.user.name} さん ・ ${d.cycle.name}${d.unit ? ` ・ ${d.unit.name}` : ''}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className={`rounded-full px-2 py-0.5 font-medium ${STAGE_STYLE[d.stage]}`}>{STAGE_LABEL[d.stage]}</span>
          <span>評価者: {d.evaluator?.name ?? '未設定'}</span>
          <span>{d.cycle.period_start} 〜 {d.cycle.period_end}</span>
        </div>
        {d.finalized_at && d.grade && (
          <div className="rounded-xl bg-emerald-50 px-4 py-3" role="status">
            <div className="text-xs text-emerald-700">評価結果</div>
            <div className="text-2xl font-bold text-emerald-800">{d.grade}<span className="ml-2 text-sm font-medium">{GRADE_LABEL[d.grade as Grade]}</span></div>
            <div className="text-xs text-emerald-700">総合点 {d.score} / 5{d.final_comment ? ` ・ ${d.final_comment}` : ''}</div>
          </div>
        )}
        <Notice msg={msg} />
        <ul className="space-y-3">
          {d.criteria.map(c => (
            <li key={c.id} className="rounded-xl border border-gray-200 p-3 space-y-2">
              <div><div className="text-sm font-semibold text-gray-900">{c.name}<span className="ml-2 text-xs font-normal text-gray-400">重み {c.weight}</span></div>{c.description && <div className="text-xs text-gray-500">{c.description}</div>}</div>
              {side ? (
                <div className="space-y-1.5">
                  <div className="text-xs text-gray-500">{side === 'self' ? '自己評価' : '上長評価'}</div>
                  <ScorePicker label={c.name} value={draft[c.id]?.score ?? null} onChange={n => setScore(c.id, n)} />
                  <input className={inp} placeholder="コメント（任意）" aria-label={`${c.name}のコメント`} value={draft[c.id]?.comment ?? ''} onChange={e => setCriterionComment(c.id, e.target.value)} />
                  {side === 'manager' && c.self_score !== null && <div className="text-xs text-gray-500">本人の自己評価: {c.self_score} 点{c.self_comment ? ` ・ ${c.self_comment}` : ''}</div>}
                </div>
              ) : (
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-gray-500">自己評価</dt><dd><ScorePicker label={c.name} value={c.self_score} readOnly />{c.self_comment && <p className="text-gray-600">{c.self_comment}</p>}</dd></div>
                  <div><dt className="text-gray-500">上長評価</dt><dd><ScorePicker label={c.name} value={c.manager_score} readOnly />{c.manager_comment && <p className="text-gray-600">{c.manager_comment}</p>}</dd></div>
                </dl>
              )}
            </li>
          ))}
        </ul>
        {side ? (
          <div className="space-y-2">
            <label className="text-xs text-gray-600">{side === 'self' ? '全体のコメント（任意）' : '評価者としての総評（任意）'}</label>
            <textarea className={inp} rows={3} value={comment} onChange={e => setComment(e.target.value)} />
            {side === 'manager' && preview !== null && <p className="text-xs text-gray-500">総合点（見込み）{preview} / 5 → {gradeFor(preview)}</p>}
            <div className="flex justify-end gap-2"><button className={btn} onClick={() => save(false)}>下書き保存</button><button className={btnPrimary} onClick={() => confirm('提出すると、あとから変更できません。提出しますか？') && save(true)}>提出する</button></div>
          </div>
        ) : (
          <>
            {d.self_comment && <p className="text-sm text-gray-700"><b className="text-xs text-gray-500">本人のコメント: </b>{d.self_comment}</p>}
            {d.manager_comment && <p className="text-sm text-gray-700"><b className="text-xs text-gray-500">評価者の総評: </b>{d.manager_comment}</p>}
          </>
        )}
        {d.viewer.isHr && <HrActions detail={d} onChanged={async () => { onChanged(); await load(); }} setMsg={setMsg} preview={preview} />}
      </div>
    </Modal>
  );
}

