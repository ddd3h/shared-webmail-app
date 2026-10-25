'use client';
import { useEffect, useState } from 'react';
import { api, btn, btnPrimary, inp } from '@/components/work/ui';
import { GRADES, GRADE_LABEL, gradeFor, type Grade } from '@/lib/org';
import type { Detail } from './types';

type Candidate = { id: string; name: string };
type Msg = { type: 'success' | 'error'; text: string } | null;

const ERRORS: Record<string, string> = {
  manager_not_submitted: '上長の評価が提出されてから確定できます', comment_required: '等級を変えるときは、理由をコメントに書いてください',
  self_finalize: '自分の評価は、他の人事担当・管理者が確定してください', finalized: 'すでに確定しています', locked: '確定後・終了後は変更できません',
};

// Evaluator candidates: system admins, and people whose 役職 lets them evaluate.
async function loadCandidates(): Promise<Candidate[]> {
  const res = await fetch('/api/org');
  if (!res.ok) return [];
  return (await res.json()).members.filter((m: { can_evaluate: boolean }) => m.can_evaluate).map((m: Candidate) => ({ id: m.id, name: m.name }));
}

// 人事担当の操作: 評価者の変更、差し戻し、結果の確定
export default function HrActions({ detail, onChanged, setMsg, preview }: { detail: Detail; onChanged: () => void; setMsg: (m: Msg) => void; preview: number | null }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [grade, setGrade] = useState<Grade | ''>('');
  const [finalComment, setFinalComment] = useState('');
  useEffect(() => { loadCandidates().then(setCandidates); }, []);

  const open = detail.cycle.status === 'open' && !detail.finalized_at;
  if (!open) return null;
  const computed = preview !== null ? gradeFor(preview) : null;

  async function call(path: string, method: string, body: unknown, ok: string) {
    const res = await api(`/api/evaluations/${detail.id}/${path}`, method, body);
    if (res.ok) { setMsg({ type: 'success', text: ok }); onChanged(); return; }
    const e = await res.json().catch(() => ({}));
    setMsg({ type: 'error', text: ERRORS[e.error] ?? e.message ?? '処理できませんでした' });
  }

  return (
    <section aria-label="人事の操作" className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
      <h4 className="text-xs font-semibold text-violet-800">人事の操作</h4>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-600">評価者</label>
        <select className={`${inp} max-w-[12rem]`} aria-label="評価者" value={detail.evaluator?.id ?? ''} onChange={e => call('evaluator', 'PUT', { evaluator_id: e.target.value || null }, '評価者を変更しました')}>
          <option value="">（未設定）</option>
          {candidates.filter(c => c.id !== detail.user.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {detail.self_submitted_at && <button className={btn} onClick={() => confirm('本人に自己評価を差し戻します（上長評価も未提出に戻ります）') && call('reopen', 'POST', { side: 'self' }, '自己評価を差し戻しました')}>自己評価を差し戻す</button>}
        {detail.manager_submitted_at && <button className={btn} onClick={() => call('reopen', 'POST', { side: 'manager' }, '上長評価を差し戻しました')}>上長評価を差し戻す</button>}
      </div>
      {detail.manager_submitted_at && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-600">確定する等級</label>
            <select className={`${inp} max-w-[14rem]`} aria-label="確定する等級" value={grade} onChange={e => setGrade(e.target.value as Grade | '')}>
              <option value="">{computed ? `自動（${computed}）` : '自動'}</option>
              {GRADES.map(g => <option key={g} value={g}>{g}: {GRADE_LABEL[g]}</option>)}
            </select>
          </div>
          <textarea className={inp} rows={2} placeholder="コメント（等級を変えるときは理由が必須。本人に表示されます）" aria-label="確定コメント" value={finalComment} onChange={e => setFinalComment(e.target.value)} />
          <div className="flex justify-end">
            <button className={btnPrimary} onClick={() => confirm('確定すると結果が本人に公開され、変更できなくなります。確定しますか？') && call('finalize', 'POST', { ...(grade ? { grade } : {}), final_comment: finalComment || null }, '確定しました')}>結果を確定して公開</button>
          </div>
        </div>
      )}
    </section>
  );
}
