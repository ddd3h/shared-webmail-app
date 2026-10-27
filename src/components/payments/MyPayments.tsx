'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Notice, Stat, api, btn, btnPrimary, inp, yen, PanelSkeleton } from '@/components/work/ui';
import { transferAmount } from '@/lib/payment';
import VendorForm, { blankVendor } from './VendorForm';
import { RequestDetail, RequestHeader, todayJst, type Request, type Summary, type Vendor } from './shared';
import FilterBar from '@/components/mobile/FilterBar';

type Form = {
  id?: string; vendor_id: string; title: string; amount: string; deduction_amount: string; fee: string; fee_bearer: 'us' | 'vendor';
  invoice_number: string; invoice_date: string; due_date: string; description: string;
};
const FILTERS = [{ k: '', l: 'すべて' }, { k: 'pending', l: '承認待ち' }, { k: 'approved', l: '振込待ち' }, { k: 'paid', l: '振込済' }, { k: 'rejected', l: '却下' }];
const MAX_FILES = 5;
const ERRORS: Record<string, string> = {
  duplicate_invoice: 'この取引先・請求書番号の申請はすでにあります（二重払い防止）',
  invalid_breakdown: '控除と手数料の合計が請求金額を超えています',
  invalid_vendor: '選べない取引先です。取引先を選び直してください',
  invalid_file_type: '請求書は画像かPDFのみ添付できます',
  file_too_large: '請求書は1枚10MBまでです',
};

export default function MyPayments({ vendors, onVendorsChanged }: { vendors: Vendor[]; onVendorsChanged: () => void }) {
  const [items, setItems] = useState<Request[]>([]);
  const [loaded, setLoaded] = useState(false);   // the first answer has arrived (until then: a placeholder, not "nothing here")
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [newVendor, setNewVendor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetch(`/api/payments${filter ? `?status=${filter}` : ''}`);
    if (mine !== seq.current) return;
    if (res.ok) { const d = await res.json(); setItems(d.items); setSummary(d.summary); }
    setLoaded(true);
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 6000); }

  const blank = (): Form => ({ vendor_id: '', title: '', amount: '', deduction_amount: '', fee: '', fee_bearer: 'us', invoice_number: '', invoice_date: '', due_date: '', description: '' });
  const editing = form?.id ? items.find(i => i.id === form.id) : undefined;
  const num = (s: string) => Math.round(Number(s) || 0);
  const preview = form ? transferAmount({ amount: num(form.amount), deduction_amount: num(form.deduction_amount), fee: num(form.fee), fee_bearer: form.fee_bearer }) : 0;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const body = {
        vendor_id: form.vendor_id, title: form.title, amount: num(form.amount), deduction_amount: num(form.deduction_amount), fee: num(form.fee), fee_bearer: form.fee_bearer,
        invoice_number: form.invoice_number || null, invoice_date: form.invoice_date || null, due_date: form.due_date, description: form.description || null,
      };
      let res: Response;
      if (form.id) {
        res = await api(`/api/payments/${form.id}`, 'PATCH', body);
        if (res.ok && files.length) {
          const fd = new FormData(); files.forEach(f => fd.append('file', f));
          const r = await fetch(`/api/payments/${form.id}/documents`, { method: 'POST', body: fd });
          if (!r.ok) { flash('error', '申請は更新しましたが、請求書のアップロードに失敗しました（画像かPDF・10MBまで・合計5枚まで）'); setForm(null); setFiles([]); load(); return; }
        }
      } else {
        const fd = new FormData();
        Object.entries({ ...body, amount: String(body.amount), deduction_amount: String(body.deduction_amount), fee: String(body.fee) }).forEach(([k, v]) => { if (v) fd.append(k, v as string); });
        files.forEach(f => fd.append('file', f));
        res = await fetch('/api/payments', { method: 'POST', body: fd });
      }
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(ERRORS[e.error] ?? '保存に失敗しました。入力内容を確認してください'); }
      setForm(null); setFiles([]); flash('success', form.id ? '申請を更新しました' : '振込を申請しました'); load();
    } catch (e: any) { flash('error', e.message); } finally { setSaving(false); }
  }
  async function withdraw(id: string) {
    if (!confirm('この振込申請を取り下げますか？')) return;
    const res = await api(`/api/payments/${id}`, 'DELETE');
    if (res.ok) { setOpen(null); load(); } else flash('error', '取り下げできませんでした');
  }
  async function removeDoc(did: string) {
    const res = await api(`/api/payments/documents/${did}`, 'DELETE');
    if (res.ok) load(); else flash('error', '削除できませんでした');
  }

  const selectedVendor = vendors.find(v => v.id === form?.vendor_id);
  return (
    <div className="space-y-4">
      {!loaded && <PanelSkeleton />}
      {summary && (
        <div className="tab-fade grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="承認待ち" value={yen(summary.pending.amount)} sub={`${summary.pending.count}件`} />
          <Stat label="振込待ち" value={yen(summary.approved.amount)} sub={`${summary.approved.count}件${summary.overdue ? ` ・ 期日超過 ${summary.overdue}件` : ''}`} />
          <Stat label="振込済" value={yen(summary.paid.amount)} sub={`${summary.paid.count}件`} />
        </div>
      )}
      <Notice msg={msg} />
      <FilterBar filters={FILTERS} value={filter} onChange={setFilter} action={{ label: '＋ 振込を申請', className: btnPrimary, onClick: () => { setForm(blank()); setFiles([]); } }} />

      <div className={`space-y-2 ${loaded ? 'tab-fade' : ''}`}>
        {loaded && items.length === 0 && <p className="text-sm text-gray-400">振込申請はありません</p>}
        {items.map(r => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white">
            <button className="w-full p-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}><RequestHeader r={r} /></button>
            {open === r.id && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                <RequestDetail r={r} />
                {(r.status === 'pending' || r.status === 'rejected') && (
                  <div className="flex gap-3 text-xs">
                    <button className="text-blue-600 hover:underline" onClick={() => {
                      setFiles([]);
                      setForm({ id: r.id, vendor_id: r.vendor.id, title: r.title, amount: String(r.amount), deduction_amount: r.deduction_amount ? String(r.deduction_amount) : '', fee: r.fee ? String(r.fee) : '', fee_bearer: r.fee_bearer, invoice_number: r.invoice_number ?? '', invoice_date: r.invoice_date ?? '', due_date: r.due_date, description: r.description ?? '' });
                    }}>{r.status === 'rejected' ? '修正して再申請' : '編集'}</button>
                    <button className="text-red-600 hover:underline" onClick={() => withdraw(r.id)}>取り下げ</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {form && (
        <Modal title={form.id ? (editing?.status === 'rejected' ? '修正して再申請' : '振込申請を編集') : '振込を申請'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-600">振込先（取引先）</label>
              <select className={inp} value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">選択してください</option>
                {vendors.filter(v => v.is_active || v.id === form.vendor_id).map(v => <option key={v.id} value={v.id}>{v.name}（{v.bank_name} {v.branch_name} {v.account_masked}）{v.verified ? '' : ' ※口座未確認'}</option>)}
              </select>
              {selectedVendor && !selectedVendor.verified && <p className="mt-1 text-xs text-amber-700">口座が未確認です。管理者が確認するまで承認されません。</p>}
              <button type="button" className="mt-1 text-xs text-blue-600 hover:underline" onClick={() => setNewVendor(true)}>＋ 新しい取引先を登録</button>
            </div>
            <div><label className="text-xs text-gray-600">件名・内容</label><input className={inp} placeholder="例: 10月分 開発業務委託費" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">請求金額（円・税込）</label><input type="number" min={1} className={`${inp} text-right`} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">支払期日</label><input type="date" className={inp} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">請求書番号（任意）</label><input className={inp} value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">請求書の日付（任意）</label><input type="date" className={inp} value={form.invoice_date} onChange={e => setForm({ ...form, invoice_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">控除（源泉所得税など・円）</label><input type="number" min={0} className={`${inp} text-right`} value={form.deduction_amount} onChange={e => setForm({ ...form, deduction_amount: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">振込手数料（円）</label><input type="number" min={0} className={`${inp} text-right`} value={form.fee} onChange={e => setForm({ ...form, fee: e.target.value })} /></div>
            </div>
            <div><label className="text-xs text-gray-600">振込手数料の負担</label>
              <select className={inp} value={form.fee_bearer} onChange={e => setForm({ ...form, fee_bearer: e.target.value as 'us' | 'vendor' })}><option value="us">当方負担</option><option value="vendor">先方負担（振込額から差し引く）</option></select></div>
            <div className={`flex justify-between rounded-lg px-3 py-2 font-bold ${preview < 0 ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-900'}`}><span>振込額</span><span className="tabular-nums">{yen(preview)}</span></div>
            <div><label className="text-xs text-gray-600">備考</label><textarea className={inp} rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <label className="text-xs text-gray-600">請求書（画像・PDF、1枚10MBまで、合計{MAX_FILES}枚まで）</label>
              {editing && editing.documents.length > 0 && (
                <ul className="mb-2 space-y-1">{editing.documents.map(d => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-xs"><span className="truncate">📎 {d.filename}</span><button className="text-red-600 hover:underline" onClick={() => removeDoc(d.id)}>削除</button></li>
                ))}</ul>
              )}
              <input type="file" multiple accept="image/*,application/pdf" className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm" onChange={e => setFiles(Array.from(e.target.files || []))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button className={btn} onClick={() => setForm(null)}>閉じる</button>
            <button className={btnPrimary} disabled={saving || preview < 0 || !form.vendor_id || !form.title.trim() || !form.amount || !form.due_date} onClick={save}>{saving ? '送信中…' : form.id ? '更新して申請' : '申請する'}</button>
          </div>
        </Modal>
      )}
      {newVendor && (
        <VendorForm initial={blankVendor()} admin={false} onClose={() => setNewVendor(false)}
          onSaved={(id, m) => { setNewVendor(false); flash('success', m); onVendorsChanged(); if (form) setForm({ ...form, vendor_id: id }); }} />
      )}
    </div>
  );
}
