'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Notice, Stat, api, btn, btnPrimary, inp, PanelSkeleton } from '@/components/work/ui';
import TripForm, { draftFromTrip, type TripDraft } from './TripForm';
import { TripDetail, TripHeader, type RateType, type Trip } from './shared';

const FILTERS = [{ k: 'pending', l: '承認待ち' }, { k: 'approved', l: '承認済' }, { k: 'rejected', l: '却下' }, { k: 'cancelled', l: '取消' }, { k: '', l: 'すべて' }];

// `canReview`: approving is for administrators; 経理担当 sees every trip and adjusts the allowances
export default function AdminTrips({ meId, types, canReview = true }: { meId: string; types: RateType[]; canReview?: boolean }) {
  const [filter, setFilter] = useState('pending');
  const [items, setItems] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);   // the first answer has arrived (until then: a placeholder, not "nothing here")
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [reject, setReject] = useState<{ id: string; comment: string } | null>(null);
  const [adjust, setAdjust] = useState<TripDraft | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetch(`/api/trips?scope=all${filter ? `&status=${filter}` : ''}`);
    if (mine !== seq.current) return;
    if (res.ok) { const d = await res.json(); setItems(d.items); setPending(d.pending_count); }
    setLoaded(true);
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); }

  async function approve(id: string) {
    const res = await api(`/api/trips/${id}/review`, 'POST', { action: 'approve' });
    if (res.ok) flash('success', '承認しました');
    else { const e = await res.json().catch(() => ({})); flash('error', e.error === 'self_approval' ? '自分の申請は他の管理者が承認してください' : '承認できませんでした（すでに処理済みの可能性があります）'); }
    load();
  }
  async function doReject() {
    if (!reject) return;
    const res = await api(`/api/trips/${reject.id}/review`, 'POST', { action: 'reject', comment: reject.comment });
    if (res.ok) { setReject(null); flash('success', '却下しました'); load(); } else flash('error', '却下にはコメントが必要です');
  }

  const totalPending = items.filter(t => t.status === 'pending').reduce((s, t) => s + t.allowance_total, 0);
  return (
    <div className="space-y-4">
      {!loaded ? <PanelSkeleton cols={2} /> : (
      <div className="tab-fade grid grid-cols-2 gap-2 sm:gap-3 max-w-md">
        <Stat label="承認待ちの出張" value={`${pending}件`} />
        {filter === 'pending' && <Stat label="承認待ちの手当合計" value={`¥${totalPending.toLocaleString('ja-JP')}`} />}
      </div>
      )}
      <Notice msg={msg} />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)} className={`rounded-full px-3 py-1.5 text-sm ${filter === f.k ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{f.l}</button>
        ))}
      </div>
      <div className={`space-y-2 ${loaded ? 'tab-fade' : ''}`}>
        {loaded && items.length === 0 && <p className="text-sm text-gray-400">該当する出張はありません</p>}
        {items.map(t => (
          <div key={t.id} className="rounded-xl border border-gray-200 bg-white">
            <button className="w-full p-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}><TripHeader t={t} showUser /></button>
            {(open === t.id || t.status === 'pending') && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                <TripDetail t={t} />
                <div className="flex flex-wrap items-center gap-2">
                  {t.status === 'pending' && canReview && (
                    <>
                      <button className={btnPrimary} onClick={() => approve(t.id)}>承認</button>
                      <button className={btn} onClick={() => setReject({ id: t.id, comment: '' })}>却下…</button>
                    </>
                  )}
                  {(t.status === 'pending' || t.status === 'approved') && <button className={btn} onClick={() => setAdjust(draftFromTrip(t))}>手当を調整</button>}
                  {t.status === 'pending' && canReview && t.user.id === meId && <span className="text-xs text-amber-600">自分の申請です（管理者が複数いる場合は他の管理者が承認します）</span>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {reject && (
        <Modal title="出張申請を却下" onClose={() => setReject(null)}>
          <label className="text-xs text-gray-600">理由（申請者に表示されます）</label>
          <textarea className={inp} rows={3} value={reject.comment} onChange={e => setReject({ ...reject, comment: e.target.value })} placeholder="例: 日程を調整してください" />
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setReject(null)}>閉じる</button><button className={btnPrimary} disabled={!reject.comment.trim()} onClick={doReject}>却下する</button></div>
        </Modal>
      )}
      {adjust && <TripForm initial={adjust} types={types} allowancesOnly onClose={() => setAdjust(null)} onSaved={m => { setAdjust(null); flash('success', m); load(); }} />}
    </div>
  );
}
