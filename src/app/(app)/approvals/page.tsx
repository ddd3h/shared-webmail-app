'use client';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';

type Expense = { id: string; user: { name: string }; title: string; category: string; amount: number; payment_method: string; expense_date: string };
type Trip = { id: string; user: { name: string }; destination: string; purpose: string; start_date: string; end_date: string };
type Data = { allowed: boolean; expenses: Expense[]; trips: Trip[] };
type Target = { kind: 'expenses' | 'trips'; id: string; label: string };

const REVIEW_ERRORS: Record<string, string> = { not_pending: 'すでに処理されています', forbidden: 'この申請を承認する権限がありません', self_approval: '自分の申請は他の人が承認してください', comment_required: '却下の理由を入力してください' };

// 自分の役職が承認の権限を持つ部署（と配下）のメンバー（管理者は全員）の、承認待ちの経費・出張
export default function ApprovalsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [reject, setReject] = useState<(Target & { comment: string }) | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/approvals'); if (r.ok) setData(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);

  async function review(t: Target, action: 'approve' | 'reject', comment?: string) {
    const res = await api(`/api/${t.kind}/${t.id}/review`, 'POST', { action, comment });
    if (res.ok) setMsg({ type: 'success', text: `${t.label}を${action === 'approve' ? '承認' : '却下'}しました` });
    else setMsg({ type: 'error', text: REVIEW_ERRORS[(await res.json().catch(() => ({}))).error] ?? '処理できませんでした' });
    setReject(null); load();
  }

  if (!data) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const empty = data.expenses.length === 0 && data.trips.length === 0;
  const row = (t: Target, title: string, who: string, detail: string, amount?: number) => (
    <li key={`${t.kind}-${t.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
      <div className="min-w-48 flex-1">
        <div className="text-xs text-gray-500">{who}</div>
        <div className="text-sm font-medium text-gray-900 wrap-break-word">{title}</div>
        <div className="text-xs text-gray-500">{detail}</div>
      </div>
      {amount !== undefined && <div className="text-base font-bold tabular-nums">{yen(amount)}</div>}
      <div className="flex gap-2">
        <button className={btnPrimary} onClick={() => review(t, 'approve')}>承認</button>
        <button className={btn} onClick={() => setReject({ ...t, comment: '' })}>却下…</button>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">チームの承認</h1>
        <p className="hidden md:block text-xs text-gray-500 mt-0.5">担当している部署のメンバーの、承認待ちの経費・出張</p>
      </div>
      <Notice msg={msg} />
      {!data.allowed && <p className="text-sm text-gray-500">承認できるメンバーがいません。部署に所属していて、その部署での役職に「部下の経費・出張を承認する」権限があると、ここに表示されます。</p>}
      {data.allowed && empty && <p className="text-sm text-gray-400">承認待ちの申請はありません</p>}
      {data.expenses.length > 0 && (
        <section className="space-y-2"><h2 className="text-sm font-semibold text-gray-700">経費（{data.expenses.length}件）</h2>
          <ul className="space-y-2">{data.expenses.map(c => row({ kind: 'expenses', id: c.id, label: `${c.user.name}さんの経費` }, c.title, c.user.name, `${c.expense_date} ・ ${c.category}・${c.payment_method === 'personal' ? '立替' : '会社負担'}`, c.amount))}</ul></section>
      )}
      {data.trips.length > 0 && (
        <section className="space-y-2"><h2 className="text-sm font-semibold text-gray-700">出張（{data.trips.length}件）</h2>
          <ul className="space-y-2">{data.trips.map(t => row({ kind: 'trips', id: t.id, label: `${t.user.name}さんの出張` }, `${t.destination} 出張`, t.user.name, `${t.start_date} 〜 ${t.end_date} ・ ${t.purpose}`))}</ul></section>
      )}
      {reject && (
        <Modal title="却下する" onClose={() => setReject(null)}>
          <label className="text-xs text-gray-600">理由（申請者に表示されます）</label>
          <textarea className={inp} rows={3} value={reject.comment} onChange={e => setReject({ ...reject, comment: e.target.value })} />
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setReject(null)}>閉じる</button><button className={btnPrimary} disabled={!reject.comment.trim()} onClick={() => review(reject, 'reject', reject.comment)}>却下する</button></div>
        </Modal>
      )}
    </div>
  );
}
