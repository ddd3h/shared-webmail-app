'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Notice, Stat, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';
import { CATEGORIES, ClaimDetail, ClaimHeader, type Claim, type Summary } from './shared';
import FilterBar from '@/components/mobile/FilterBar';
import { MILEAGE_CATEGORY } from '@/lib/expense';

type Trip = { id: string; destination: string; start_date: string; end_date: string };
type Form = { id?: string; trip_id: string; expense_date: string; category: string; title: string; amount: string; payment_method: 'personal' | 'company'; description: string; destination: string; manual_km: string };
type MileageInfo = { rate_per_km: number; route_service: boolean; home_address: string | null };
type Estimate = { destination: string; round_trip_km: number; rate_per_km: number; amount: number; source: 'google' | 'osm' | 'manual'; map_url: string };
const MILEAGE_ERRORS: Record<string, string> = {
  home_not_set: '先にプロフィールで自宅を登録してください',
  route_not_found: '行き先が見つかりません。住所や施設名をもう少し詳しく入力してください',
  route_failed: 'ルートを調べられませんでした。しばらくしてからもう一度お試しください',
  distance_required: '片道の距離（km）を入力してください',
  manual_not_allowed: 'ルートは自動で調べます。行き先だけ入力してください',
  too_many_requests: '計算の回数が多すぎます。少し待ってからもう一度お試しください',
};
const FILTERS = [{ k: '', l: 'すべて' }, { k: 'pending', l: '承認待ち' }, { k: 'owed', l: '返金待ち' }, { k: 'paid', l: '返金済' }, { k: 'rejected', l: '却下' }];
const MAX_FILES = 5;

export default function MyExpenses({ initialTripId }: { initialTripId?: string }) {
  const [items, setItems] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [mi, setMi] = useState<MileageInfo | null>(null);   // own-car claims: the rate, whether routes are searched, whether a home address is on file
  const [est, setEst] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estError, setEstError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetch(`/api/expenses${filter ? `?status=${filter}` : ''}`);
    if (mine !== seq.current) return; // ignore a stale response
    if (res.ok) { const d = await res.json(); setItems(d.items); setSummary(d.summary); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch('/api/expenses/mileage').then(r => r.json()).then(setMi).catch(() => {}); }, []);
  useEffect(() => {
    fetch('/api/trips?status=approved').then(r => r.json()).then(d => setTrips((d.items || []).map((t: any) => ({ id: t.id, destination: t.destination, start_date: t.start_date, end_date: t.end_date })))).catch(() => setTrips([]));
  }, []);
  // arriving from a trip's "この出張の経費を申請" link: open the form with that trip selected
  const prefilled = useRef(false);
  useEffect(() => {
    if (!initialTripId || prefilled.current || trips === null) return;
    prefilled.current = true;
    if (trips.some(t => t.id === initialTripId)) openForm({ ...blank(), trip_id: initialTripId });
  }, [initialTripId, trips]); // eslint-disable-line react-hooks/exhaustive-deps
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); }

  const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const blank = (): Form => ({ trip_id: '', expense_date: today(), category: CATEGORIES[0], title: '', amount: '', payment_method: 'personal', description: '', destination: '', manual_km: '' });
  const editing = form?.id ? items.find(i => i.id === form.id) : undefined;

  const isMileage = form?.category === MILEAGE_CATEGORY;
  // the destination or the typed distance changed: the figure on screen is no longer the one for it
  function editForm(next: Form) {
    if (next.destination !== form?.destination || next.manual_km !== form?.manual_km) { setEst(null); setEstError(null); }
    setForm(next);
  }
  function openForm(f: Form, claim?: Claim) {
    setFiles([]); setEstError(null);
    setEst(claim?.mileage ? { destination: claim.mileage.destination, round_trip_km: claim.mileage.round_trip_km, rate_per_km: claim.mileage.rate_per_km, amount: claim.amount, source: claim.mileage.source, map_url: claim.mileage.map_url } : null);
    setForm(f);
  }
  async function estimate() {
    if (!form || !form.destination.trim()) return;
    setEstimating(true); setEstError(null); setEst(null);
    try {
      const body: Record<string, unknown> = { destination: form.destination.trim() };
      if (mi && !mi.route_service) body.manual_one_way_km = Number(form.manual_km);
      const res = await api('/api/expenses/mileage/estimate', 'POST', body);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setEstError(MILEAGE_ERRORS[d.error] ?? '計算できませんでした'); return; }
      setEst(d);
      if (!form.title.trim()) setForm({ ...form, title: `自家用車: 自宅→${form.destination.trim()}` });
    } finally { setEstimating(false); }
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      let id = form.id;
      if (id) {
        const res = await api(`/api/expenses/${id}`, 'PATCH', {
          expense_date: form.expense_date, category: form.category, title: form.title,
          payment_method: form.payment_method, description: form.description || null, trip_id: form.trip_id || null,
          ...(isMileage ? { destination: form.destination.trim(), ...(est?.source === 'manual' && form.manual_km ? { manual_one_way_km: Number(form.manual_km) } : {}) } : { amount: Number(form.amount) }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(MILEAGE_ERRORS[e.error] ?? ''); }
        if (files.length) {
          const fd = new FormData(); files.forEach(f => fd.append('file', f));
          const r = await fetch(`/api/expenses/${id}/receipts`, { method: 'POST', body: fd });
          if (!r.ok) { flash('error', '申請は更新しましたが、領収書のアップロードに失敗しました（画像かPDF・10MBまで・合計5枚まで）'); setForm(null); setFiles([]); load(); return; }
        }
      } else {
        const fd = new FormData();
        (['expense_date', 'category', 'title', 'payment_method', 'description'] as const).forEach(k => fd.append(k, form[k]));
        if (isMileage) { fd.append('destination', form.destination.trim()); if (est?.source === 'manual' && form.manual_km) fd.append('manual_one_way_km', form.manual_km); } else fd.append('amount', form.amount);
        if (form.trip_id) fd.append('trip_id', form.trip_id);
        files.forEach(f => fd.append('file', f));
        const res = await fetch('/api/expenses', { method: 'POST', body: fd });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(MILEAGE_ERRORS[e.error] ?? (e.error === 'invalid_file_type' ? '領収書は画像かPDFのみ添付できます' : e.error === 'file_too_large' ? '領収書は1枚10MBまでです' : ''));
        }
      }
      setForm(null); setFiles([]); flash('success', form.id ? '申請を更新しました' : '申請しました'); load();
    } catch (e: any) {
      flash('error', e?.message || '保存に失敗しました。入力内容（金額は1円以上の整数）を確認してください');
    } finally { setSaving(false); }
  }

  async function withdraw(id: string) {
    if (!confirm('この申請を取り下げますか？')) return;
    const res = await api(`/api/expenses/${id}`, 'DELETE');
    if (res.ok) { setOpen(null); load(); } else flash('error', '取り下げできませんでした');
  }
  async function removeReceipt(rid: string) {
    const res = await api(`/api/expenses/receipts/${rid}`, 'DELETE');
    if (res.ok) load(); else flash('error', '削除できませんでした');
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="承認待ち" value={yen(summary.pending.amount)} sub={`${summary.pending.count}件`} />
          <Stat label="返金待ちの立替金" value={yen(summary.to_reimburse.amount + summary.in_payslip.amount)} sub={summary.in_payslip.count > 0 ? `うち給与明細に合算済 ${yen(summary.in_payslip.amount)}` : `${summary.to_reimburse.count}件・承認済で、まだ返金されていない分`} />
          <Stat label="返金済みの合計" value={yen(summary.paid.amount)} sub={`${summary.paid.count}件`} />
        </div>
      )}
      <Notice msg={msg} />
      <FilterBar filters={FILTERS} value={filter} onChange={setFilter} action={{ label: '＋ 経費を申請', className: btnPrimary, onClick: () => openForm(blank()) }} />

      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-gray-400">申請はありません</p>}
        {items.map(c => (
          <div key={c.id} className="rounded-xl border border-gray-200 bg-white">
            <button className="w-full p-3 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}><ClaimHeader c={c} /></button>
            {open === c.id && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                <ClaimDetail c={c} />
                {(c.status === 'pending' || c.status === 'rejected') && (
                  <div className="flex gap-3 text-xs">
                    <button className="text-blue-600 hover:underline" onClick={() => openForm({ id: c.id, trip_id: c.trip?.id ?? '', expense_date: c.expense_date, category: c.category, title: c.title, amount: String(c.amount), payment_method: c.payment_method, description: c.description || '', destination: c.mileage?.destination ?? '', manual_km: '' }, c)}>
                      {c.status === 'rejected' ? '修正して再申請' : '編集'}
                    </button>
                    <button className="text-red-600 hover:underline" onClick={() => withdraw(c.id)}>取り下げ</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {form && (
        <Modal title={form.id ? (editing?.status === 'rejected' ? '修正して再申請' : '申請を編集') : '経費を申請'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">利用日</label><input type="date" className={inp} value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">勘定科目</label>
                <select className={inp} value={form.category} onChange={e => editForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
            </div>
            {(() => {
              // a cancelled trip the claim is already linked to must stay visible as an option
              const options = [...(trips ?? [])];
              if (editing?.trip && !options.some(t => t.id === editing.trip!.id)) options.push(editing.trip);
              if (options.length === 0) return null;
              const sel = options.find(t => t.id === form.trip_id);
              const outside = sel && (form.expense_date < sel.start_date || form.expense_date > sel.end_date);
              return (
                <div><label className="text-xs text-gray-600">出張に紐付ける（任意）</label>
                  <select className={inp} value={form.trip_id} onChange={e => setForm({ ...form, trip_id: e.target.value })}>
                    <option value="">紐付けない</option>
                    {options.map(t => <option key={t.id} value={t.id}>✈ {t.destination}（{t.start_date.slice(5).replace('-', '/')}〜{t.end_date.slice(5).replace('-', '/')}）</option>)}
                  </select>
                  {outside && <p className="mt-1 text-xs text-amber-700">利用日が出張期間外です（事前に購入した切符などの場合はそのままで構いません）。</p>}
                </div>
              );
            })()}
            <div><label className="text-xs text-gray-600">件名・用途</label><input className={inp} placeholder="例: A社訪問の交通費（川越→新宿）" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            {isMileage ? (
              <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
                {mi && !mi.home_address ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">自宅が登録されていません。<a href="/profile#home" className="underline">プロフィールで自宅を登録</a>してから申請してください。</p>
                ) : (
                  <>
                    <p className="text-xs text-sky-800">自宅{mi?.home_address ? `（${mi.home_address}）` : ''}から行き先までの往復を、{mi ? `1kmあたり${mi.rate_per_km}円` : '1kmあたりの単価'}で計算します。</p>
                    <div><label className="text-xs text-gray-600" htmlFor="mileage-destination">行き先（住所・施設名）</label>
                      <input id="mileage-destination" className={inp} placeholder="例: 東京都港区芝公園4-2-8（東京タワー）" maxLength={300} value={form.destination} onChange={e => editForm({ ...form, destination: e.target.value })} /></div>
                    {mi && !mi.route_service && (
                      <div><label className="text-xs text-gray-600" htmlFor="mileage-km">片道の距離（km）</label>
                        <input id="mileage-km" type="number" min={0.1} step={0.1} className={`${inp} text-right`} value={form.manual_km} onChange={e => editForm({ ...form, manual_km: e.target.value })} />
                        <p className="mt-1 text-xs text-amber-700">ルートの自動検索を使わない設定のため、距離を自分で入力します。承認者が地図で確認します。</p></div>
                    )}
                    <button type="button" className={`${btn} w-full`} disabled={estimating || !form.destination.trim() || (mi !== null && !mi.route_service && !(Number(form.manual_km) > 0))} onClick={estimate}>{estimating ? '計算中…' : mi && !mi.route_service ? '金額を計算' : 'ルートを調べて金額を計算'}</button>
                    {estError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{estError}</p>}
                    {est && (
                      <div className="rounded-lg bg-white px-3 py-2 text-sm" data-testid="mileage-result">
                        <div className="text-xs text-gray-500">往復 {est.round_trip_km} km × {est.rate_per_km}円</div>
                        <div className="text-lg font-bold tabular-nums">{yen(est.amount)}</div>
                        <a href={est.map_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">地図でルートを確認</a>
                      </div>
                    )}
                    <p className="text-xs text-violet-700">承認後、立替金として返金されます（自家用車は立替になります）。</p>
                  </>
                )}
              </div>
            ) : (
              <>
            <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-600">金額（円）</label><input type="number" min={1} className={`${inp} text-right`} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div><label className="text-xs text-gray-600">支払方法</label>
                  <select className={inp} value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value as 'personal' | 'company' })}><option value="personal">立替（自分で支払った）</option><option value="company">会社負担（会社カード等）</option></select></div>
              </div>
              {form.payment_method === 'personal' && <p className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">承認後、立替金の返金対象になります。</p>}
              </>
            )}
            <div><label className="text-xs text-gray-600">備考</label><textarea className={inp} rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <label className="text-xs text-gray-600">領収書（画像・PDF、1枚10MBまで、合計{MAX_FILES}枚まで）</label>
              {editing && editing.receipts.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {editing.receipts.map(r => (
                    <li key={r.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-xs"><span className="truncate">📎 {r.filename}</span><button className="text-red-600 hover:underline" onClick={() => removeReceipt(r.id)}>削除</button></li>
                  ))}
                </ul>
              )}
              <input type="file" multiple accept="image/*,application/pdf" className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm" onChange={e => setFiles(Array.from(e.target.files || []))} />
              {files.length > 0 && <p className="mt-1 text-xs text-gray-500">{files.length}枚を添付します</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setForm(null)}>閉じる</button><button className={btnPrimary} disabled={saving || (isMileage && !est)} onClick={save}>{saving ? '送信中…' : form.id ? '更新して申請' : '申請する'}</button></div>
        </Modal>
      )}
    </div>
  );
}
