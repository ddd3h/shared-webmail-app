'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Notice, Stat, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';
import { ClaimDetail, ClaimHeader, type Claim, type Summary } from './shared';

type ByUser = { user_id: string; name: string; count: number; amount: number };
const FILTERS = [{ k: 'pending', l: '承認待ち' }, { k: 'to_reimburse', l: '返金待ち' }, { k: 'in_payslip', l: '給与に合算済' }, { k: 'paid', l: '返金済' }, { k: 'rejected', l: '却下' }, { k: '', l: 'すべて' }];

export default function AdminExpenses({ meId, canReview = true }: { meId: string; canReview?: boolean }) {
  const [filter, setFilter] = useState('pending');
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byUser, setByUser] = useState<ByUser[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reject, setReject] = useState<{ id: string; comment: string } | null>(null);
  const [pay, setPay] = useState<{ mode: 'separate' | 'payslip'; date: string; month: string; note: string } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const seq = useRef(0);
  const load = useCallback(async () => {
    const q = new URLSearchParams({ scope: 'all', ...(filter ? { status: filter } : {}), ...(userId ? { userId } : {}) });
    const mine = ++seq.current;
    const res = await fetch(`/api/expenses?${q}`);
    // a slower, older request must not overwrite the list of the filter chosen since
    if (mine !== seq.current) return;
    if (res.ok) { const d = await res.json(); setItems(d.items); setSummary(d.summary); setByUser(d.to_reimburse_by_user || []); setSelected(new Set()); }
  }, [filter, userId]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); }

  async function approve(id: string) {
    const res = await api(`/api/expenses/${id}/review`, 'POST', { action: 'approve' });
    if (res.ok) { flash('success', '承認しました'); load(); }
    else { const e = await res.json().catch(() => ({})); flash('error', e.error === 'self_approval' ? '自分の申請は他の管理者が承認してください' : '承認できませんでした（すでに処理済みの可能性があります）'); load(); }
  }
  async function doReject() {
    if (!reject) return;
    const res = await api(`/api/expenses/${reject.id}/review`, 'POST', { action: 'reject', comment: reject.comment });
    if (res.ok) { setReject(null); flash('success', '却下しました'); load(); } else flash('error', '却下にはコメントが必要です');
  }
  async function doPay() {
    if (!pay) return;
    const body = pay.mode === 'payslip'
      ? { ids: [...selected], mode: 'payslip', pay_month: pay.month }
      : { ids: [...selected], mode: 'separate', paid_date: pay.date, note: pay.note || undefined };
    const res = await api('/api/expenses/reimburse', 'POST', body);
    if (res.ok) {
      const d = await res.json(); setPay(null);
      const skipped = d.skipped ? `（${d.skipped}件は対象外）` : '';
      flash('success', pay.mode === 'payslip' ? `${d.attached}件を${Number(pay.month.slice(5))}月分の給与明細に合算しました${skipped}` : `${d.reimbursed}件を返金済にしました${skipped}`);
      load();
    } else flash('error', '返金処理に失敗しました');
  }
  async function unlink() {
    if (!confirm(`選択した${selected.size}件を給与明細から外し、返金待ちに戻しますか？`)) return;
    const res = await api('/api/expenses/unlink', 'POST', { ids: [...selected] });
    if (res.ok) { const d = await res.json(); flash('success', `${d.detached}件を給与明細から外しました${d.skipped ? `（${d.skipped}件は支払済の明細のため外せません）` : ''}`); load(); } else flash('error', '解除に失敗しました');
  }

  const people = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach(i => m.set(i.user.id, i.user.name)); byUser.forEach(b => m.set(b.user_id, b.name));
    return [...m.entries()];
  }, [items, byUser]);
  const selectedTotal = items.filter(i => selected.has(i.id)).reduce((s, i) => s + i.amount, 0);
  const canSelect = filter === 'to_reimburse' || filter === 'in_payslip';
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="承認待ち" value={`${summary.pending.count}件`} sub={yen(summary.pending.amount)} />
          <Stat label="返金待ちの立替金（全員）" value={yen(summary.to_reimburse.amount)} sub={`${summary.to_reimburse.count}件${summary.in_payslip.count ? ` ・ 給与に合算済 ${yen(summary.in_payslip.amount)}` : ''}`} />
          <Stat label="返金済みの合計" value={yen(summary.paid.amount)} sub={`${summary.paid.count}件`} />
        </div>
      )}
      <Notice msg={msg} />

      {canSelect && byUser.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-xs font-semibold text-gray-500 mb-2">人ごとの返金額</div>
          <div className="flex flex-wrap gap-2">
            {byUser.map(b => (
              <button key={b.user_id} onClick={() => setUserId(userId === b.user_id ? '' : b.user_id)}
                className={`rounded-lg border px-3 py-2 text-left ${userId === b.user_id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <div className="text-xs text-gray-500">{b.name}（{b.count}件）</div><div className="text-sm font-bold tabular-nums">{yen(b.amount)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => { setFilter(f.k); setUserId(''); }} className={`rounded-full px-3 py-1.5 text-sm ${filter === f.k ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{f.l}</button>
        ))}
        <div className="flex-1" />
        <select className={`${inp} max-w-48`} value={userId} onChange={e => setUserId(e.target.value)} aria-label="申請者で絞り込み">
          <option value="">全員</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      {canSelect && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button className="text-blue-600 hover:underline" onClick={() => setSelected(new Set(items.map(i => i.id)))}>すべて選択</button>
          <button className="text-gray-500 hover:underline" onClick={() => setSelected(new Set())}>選択解除</button>
          <div className="flex-1" />
          <span className="text-gray-600">選択中 {selected.size}件 ・ <b className="tabular-nums">{yen(selectedTotal)}</b></span>
          {filter === 'to_reimburse'
            ? <button className={btnPrimary} disabled={selected.size === 0} onClick={() => setPay({ mode: 'payslip', date: today(), month: items.filter(i => selected.has(i.id) && i.pay_plan).map(i => i.pay_plan!.period).sort()[0] ?? today().slice(0, 7), note: '' })}>返金する…</button>
            : <button className={btn} disabled={selected.size === 0} onClick={unlink}>給与明細から外す</button>}
        </div>
      )}

      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-gray-400">該当する申請はありません</p>}
        {items.map(c => (
          <div key={c.id} className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-start gap-2 p-3">
              {canSelect && <input type="checkbox" className="mt-2 h-4 w-4" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label="選択" />}
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}><ClaimHeader c={c} showUser /></button>
            </div>
            {(open === c.id || c.status === 'pending') && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                <ClaimDetail c={c} />
                {c.status === 'pending' && canReview && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button className={btnPrimary} onClick={() => approve(c.id)}>承認</button>
                    <button className={btn} onClick={() => setReject({ id: c.id, comment: '' })}>却下…</button>
                    {c.user.id === meId && <span className="text-xs text-amber-600">自分の申請です（管理者が複数いる場合は他の管理者が承認します）</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {reject && (
        <Modal title="申請を却下" onClose={() => setReject(null)}>
          <label className="text-xs text-gray-600">理由（申請者に表示されます）</label>
          <textarea className={inp} rows={3} value={reject.comment} onChange={e => setReject({ ...reject, comment: e.target.value })} placeholder="例: 領収書の宛名が確認できません。再添付してください" />
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setReject(null)}>閉じる</button><button className={btnPrimary} disabled={!reject.comment.trim()} onClick={doReject}>却下する</button></div>
        </Modal>
      )}
      {pay && (
        <Modal title="立替金を返金する" onClose={() => setPay(null)}>
          <p className="text-sm text-gray-700 mb-3">{selected.size}件・合計 <b className="tabular-nums">{yen(selectedTotal)}</b></p>
          <div className="space-y-2 mb-3">
            <label className={`flex gap-3 rounded-xl border p-3 cursor-pointer ${pay.mode === 'payslip' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <input type="radio" className="mt-1" checked={pay.mode === 'payslip'} onChange={() => setPay({ ...pay, mode: 'payslip' })} />
              <span><span className="block text-sm font-medium text-gray-900">給与明細に合算する</span>
                <span className="block text-xs text-gray-500">その人の対象月の明細に「立替金精算」の行を自動で追加します。明細を支払済にすると、返金済になります。</span></span>
            </label>
            <label className={`flex gap-3 rounded-xl border p-3 cursor-pointer ${pay.mode === 'separate' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <input type="radio" className="mt-1" checked={pay.mode === 'separate'} onChange={() => setPay({ ...pay, mode: 'separate' })} />
              <span><span className="block text-sm font-medium text-gray-900">別途返金済にする</span>
                <span className="block text-xs text-gray-500">給与とは別に振込・精算した場合。すぐに返金済になります。</span></span>
            </label>
          </div>
          {pay.mode === 'payslip' ? (
            <div><label className="text-xs text-gray-600">合算する明細の対象月</label><input type="month" className={inp} value={pay.month} onChange={e => setPay({ ...pay, month: e.target.value })} />
              <p className="mt-1 text-[11px] text-gray-400">支払予定の「給与」明細があればそこへ、なければ「立替金精算」の明細を新しく作ります。</p></div>
          ) : (
            <div className="space-y-3">
              <div><label className="text-xs text-gray-600">返金日</label><input type="date" className={inp} value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">メモ（任意）</label><input className={inp} placeholder="例: 現金で精算" value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} /></div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setPay(null)}>閉じる</button>
            <button className={btnPrimary} disabled={pay.mode === 'payslip' && !pay.month} onClick={doPay}>{pay.mode === 'payslip' ? '給与明細に合算する' : '返金済にする'}</button></div>
        </Modal>
      )}
    </div>
  );
}
