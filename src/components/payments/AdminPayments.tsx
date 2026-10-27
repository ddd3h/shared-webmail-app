'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Notice, Stat, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';
import { RequestDetail, RequestHeader, todayJst, type Request, type Summary } from './shared';

const FILTERS = [{ k: 'pending', l: '承認待ち' }, { k: 'approved', l: '振込待ち' }, { k: 'paid', l: '振込済' }, { k: 'rejected', l: '却下' }, { k: '', l: 'すべて' }];

// `canReview`: approving is for administrators; 経理担当 sees every request and makes the transfers
export default function AdminPayments({ meId, onVendorsChanged, canReview = true }: { meId: string; onVendorsChanged: () => void; canReview?: boolean }) {
  const [filter, setFilter] = useState('pending');
  const [items, setItems] = useState<Request[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reject, setReject] = useState<{ id: string; comment: string } | null>(null);
  const [pay, setPay] = useState<{ date: string; note: string } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetch(`/api/payments?scope=all${filter ? `&status=${filter}` : ''}`);
    if (mine !== seq.current) return;
    if (res.ok) { const d = await res.json(); setItems(d.items); setSummary(d.summary); setSelected(new Set()); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 6000); }

  async function approve(id: string) {
    const res = await api(`/api/payments/${id}/review`, 'POST', { action: 'approve' });
    if (res.ok) flash('success', '承認しました');
    else {
      const e = await res.json().catch(() => ({}));
      flash('error', e.error === 'self_approval' ? '自分の申請は他の管理者が承認してください' : e.error === 'vendor_unverified' ? '振込先の口座が未確認です。先に口座を確認済にしてください' : '承認できませんでした（すでに処理済みの可能性があります）');
    }
    load();
  }
  async function verify(vendorId: string) {
    const res = await api(`/api/payments/vendors/${vendorId}/verify`, 'POST');
    if (res.ok) { flash('success', '口座を確認済にしました'); onVendorsChanged(); load(); } else flash('error', '確認できませんでした');
  }
  async function doReject() {
    if (!reject) return;
    const res = await api(`/api/payments/${reject.id}/review`, 'POST', { action: 'reject', comment: reject.comment });
    if (res.ok) { setReject(null); flash('success', '却下しました'); load(); } else flash('error', '却下にはコメントが必要です');
  }
  async function doPay() {
    if (!pay) return;
    const res = await api('/api/payments/mark-paid', 'POST', { ids: [...selected], paid_date: pay.date, note: pay.note || undefined });
    if (res.ok) { const d = await res.json(); setPay(null); flash('success', `${d.paid}件を振込済にしました${d.skipped ? `（${d.skipped}件は対象外。口座が未確認の可能性があります）` : ''}`); load(); } else flash('error', '処理に失敗しました');
  }
  function exportCsv() {
    const ids = selected.size ? `?ids=${[...selected].join(',')}` : '';
    window.location.href = `/api/payments/export${ids}`;
  }

  const canSelect = filter === 'approved';
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedTotal = items.filter(i => selected.has(i.id)).reduce((s, i) => s + i.transfer_amount, 0);

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="承認待ち" value={`${summary.pending.count}件`} sub={yen(summary.pending.amount)} />
          <Stat label="振込待ち（全員）" value={yen(summary.approved.amount)} sub={`${summary.approved.count}件${summary.overdue ? ` ・ 期日超過 ${summary.overdue}件` : ''}`} />
          <Stat label="振込済の合計" value={yen(summary.paid.amount)} sub={`${summary.paid.count}件`} />
        </div>
      )}
      <Notice msg={msg} />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)} className={`rounded-full px-3 py-1.5 text-sm ${filter === f.k ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{f.l}</button>
        ))}
      </div>

      {canSelect && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button className="text-blue-600 hover:underline" onClick={() => setSelected(new Set(items.map(i => i.id)))}>すべて選択</button>
          <button className="text-gray-500 hover:underline" onClick={() => setSelected(new Set())}>選択解除</button>
          <div className="flex-1" />
          <span className="text-gray-600">選択中 {selected.size}件 ・ <b className="tabular-nums">{yen(selectedTotal)}</b></span>
          <button className={btn} onClick={exportCsv}>CSV出力{selected.size ? '（選択分）' : '（全件）'}</button>
          <button className={btnPrimary} disabled={selected.size === 0} onClick={() => setPay({ date: todayJst(), note: '' })}>振込済にする</button>
        </div>
      )}

      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-gray-400">該当する申請はありません</p>}
        {items.map(r => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-start gap-2 p-3">
              {canSelect && <input type="checkbox" className="mt-2 h-4 w-4" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="選択" />}
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}><RequestHeader r={r} showUser /></button>
            </div>
            {(open === r.id || r.status === 'pending') && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                <RequestDetail r={r} />
                {r.status === 'pending' && (
                  <div className="space-y-2">
                    {!r.vendor.verified && (
                      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 flex flex-wrap items-center gap-2">
                        <span>この口座は未確認です。請求書の記載と照合してから確認済にしてください。</span>
                        <button className="rounded-sm bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700" onClick={() => verify(r.vendor.id)}>口座を確認済にする</button>
                      </div>
                    )}
                    {canReview && <div className="flex flex-wrap items-center gap-2">
                      <button className={btnPrimary} disabled={!r.vendor.verified} onClick={() => approve(r.id)}>承認</button>
                      <button className={btn} onClick={() => setReject({ id: r.id, comment: '' })}>却下…</button>
                      {r.user.id === meId && <span className="text-xs text-amber-600">自分の申請です（管理者が複数いる場合は他の管理者が承認します）</span>}
                    </div>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {reject && (
        <Modal title="振込申請を却下" onClose={() => setReject(null)}>
          <label className="text-xs text-gray-600">理由（申請者に表示されます）</label>
          <textarea className={inp} rows={3} value={reject.comment} onChange={e => setReject({ ...reject, comment: e.target.value })} placeholder="例: 請求書の金額と一致しません" />
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setReject(null)}>閉じる</button><button className={btnPrimary} disabled={!reject.comment.trim()} onClick={doReject}>却下する</button></div>
        </Modal>
      )}
      {pay && (
        <Modal title="振込済にする" onClose={() => setPay(null)}>
          <p className="text-sm text-gray-700 mb-3">{selected.size}件・合計 <b className="tabular-nums">{yen(selectedTotal)}</b> を振込済にします。実際の振込は、銀行側で済ませてから記録してください。</p>
          <div className="space-y-3">
            <div><label className="text-xs text-gray-600">振込日</label><input type="date" className={inp} value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} /></div>
            <div><label className="text-xs text-gray-600">メモ（任意）</label><input className={inp} placeholder="例: 総合振込 10/31分" value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setPay(null)}>閉じる</button><button className={btnPrimary} onClick={doPay}>振込済にする</button></div>
        </Modal>
      )}
    </div>
  );
}
