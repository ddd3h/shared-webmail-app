'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Notice, api, btnPrimary, PanelSkeleton } from '@/components/work/ui';
import TripForm, { draftFromTrip, type TripDraft } from './TripForm';
import { TripDetail, TripHeader, type RateType, type Trip } from './shared';
import FilterBar from '@/components/mobile/FilterBar';

const FILTERS = [{ k: '', l: 'すべて' }, { k: 'pending', l: '承認待ち' }, { k: 'approved', l: '承認済' }, { k: 'rejected', l: '却下' }, { k: 'cancelled', l: '取消' }];

export default function MyTrips({ types }: { types: RateType[] }) {
  const [items, setItems] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);   // the first answer has arrived (until then: a placeholder, not "nothing here")
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ draft: TripDraft; resubmit: boolean } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetch(`/api/trips${filter ? `?status=${filter}` : ''}`);
    if (mine !== seq.current) return;
    if (res.ok) setItems((await res.json()).items);
    setLoaded(true);
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); }

  const blank = (): TripDraft => ({ destination: '', purpose: '', start_date: '', end_date: '', daily: types.find(t => t.kind === 'daily')?.id ?? '', addons: [] });

  async function withdraw(id: string) {
    if (!confirm('この出張申請を取り下げますか？')) return;
    const res = await api(`/api/trips/${id}`, 'DELETE');
    if (res.ok) { setOpen(null); load(); } else flash('error', '取り下げできませんでした');
  }
  async function cancel(id: string) {
    if (!confirm('承認済みの出張を取り消しますか？（紐付いた経費はそのまま残ります）')) return;
    const res = await api(`/api/trips/${id}/cancel`, 'POST');
    if (res.ok) { flash('success', '出張を取り消しました'); load(); } else flash('error', '取り消せませんでした');
  }

  return (
    <div className="space-y-4">
      <Notice msg={msg} />
      <FilterBar filters={FILTERS} value={filter} onChange={setFilter} action={{ label: '＋ 出張を申請', className: btnPrimary, onClick: () => setForm({ draft: blank(), resubmit: false }) }} />

      <div className={`space-y-2 ${loaded ? 'tab-fade' : ''}`}>
        {loaded && items.length === 0 && <p className="text-sm text-gray-400">出張の申請はありません</p>}
        {items.map(t => (
          <div key={t.id} className="rounded-xl border border-gray-200 bg-white">
            <button className="w-full p-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}><TripHeader t={t} /></button>
            {open === t.id && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                <TripDetail t={t} />
                <div className="flex flex-wrap gap-3 text-xs">
                  {t.status === 'approved' && <Link className="text-blue-600 hover:underline" href={`/expenses?trip=${t.id}`}>＋ この出張の経費を申請</Link>}
                  {(t.status === 'pending' || t.status === 'rejected') && (
                    <>
                      <button className="text-blue-600 hover:underline" onClick={() => setForm({ draft: draftFromTrip(t), resubmit: t.status === 'rejected' })}>{t.status === 'rejected' ? '修正して再申請' : '編集'}</button>
                      <button className="text-red-600 hover:underline" onClick={() => withdraw(t.id)}>取り下げ</button>
                    </>
                  )}
                  {t.status === 'approved' && <button className="text-red-600 hover:underline" onClick={() => cancel(t.id)}>出張を取り消す</button>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {form && <TripForm initial={form.draft} types={types} resubmit={form.resubmit} onClose={() => setForm(null)} onSaved={m => { setForm(null); flash('success', m); load(); }} />}
    </div>
  );
}
