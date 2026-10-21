'use client';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Notice, Stat, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';
import { CATEGORIES, ClaimDetail, ClaimHeader, type Claim, type Summary } from './shared';

type Form = { id?: string; expense_date: string; category: string; title: string; amount: string; payment_method: 'personal' | 'company'; description: string };
const FILTERS = [{ k: '', l: 'すべて' }, { k: 'pending', l: '承認待ち' }, { k: 'to_reimburse', l: '返金待ち' }, { k: 'paid', l: '返金済' }, { k: 'rejected', l: '却下' }];
const MAX_FILES = 5;

export default function MyExpenses() {
  const [items, setItems] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/expenses${filter ? `?status=${filter}` : ''}`);
    if (res.ok) { const d = await res.json(); setItems(d.items); setSummary(d.summary); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); }

  const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const blank = (): Form => ({ expense_date: today(), category: CATEGORIES[0], title: '', amount: '', payment_method: 'personal', description: '' });
  const editing = form?.id ? items.find(i => i.id === form.id) : undefined;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      let id = form.id;
      if (id) {
        const res = await api(`/api/expenses/${id}`, 'PATCH', {
          expense_date: form.expense_date, category: form.category, title: form.title, amount: Number(form.amount),
          payment_method: form.payment_method, description: form.description || null,
        });
        if (!res.ok) throw new Error();
        if (files.length) {
          const fd = new FormData(); files.forEach(f => fd.append('file', f));
          const r = await fetch(`/api/expenses/${id}/receipts`, { method: 'POST', body: fd });
          if (!r.ok) { flash('error', '申請は更新しましたが、領収書のアップロードに失敗しました（画像かPDF・10MBまで・合計5枚まで）'); setForm(null); setFiles([]); load(); return; }
        }
      } else {
        const fd = new FormData();
        (['expense_date', 'category', 'title', 'amount', 'payment_method', 'description'] as const).forEach(k => fd.append(k, form[k]));
        files.forEach(f => fd.append('file', f));
        const res = await fetch('/api/expenses', { method: 'POST', body: fd });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error === 'invalid_file_type' ? '領収書は画像かPDFのみ添付できます' : e.error === 'file_too_large' ? '領収書は1枚10MBまでです' : '');
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
          <Stat label="返金待ちの立替金" value={yen(summary.to_reimburse.amount)} sub={`${summary.to_reimburse.count}件・承認済で、まだ返金されていない分`} />
          <Stat label="返金済みの合計" value={yen(summary.paid.amount)} sub={`${summary.paid.count}件`} />
        </div>
      )}
      <Notice msg={msg} />
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)} className={`rounded-full px-3 py-1.5 text-sm ${filter === f.k ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{f.l}</button>
        ))}
        <div className="flex-1" />
        <button className={btnPrimary} onClick={() => { setForm(blank()); setFiles([]); }}>＋ 経費を申請</button>
      </div>

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
                    <button className="text-blue-600 hover:underline" onClick={() => { setFiles([]); setForm({ id: c.id, expense_date: c.expense_date, category: c.category, title: c.title, amount: String(c.amount), payment_method: c.payment_method, description: c.description || '' }); }}>
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
                <select className={inp} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
            </div>
            <div><label className="text-xs text-gray-600">件名・用途</label><input className={inp} placeholder="例: A社訪問の交通費（川越→新宿）" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">金額（円）</label><input type="number" min={1} className={`${inp} text-right`} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">支払方法</label>
                <select className={inp} value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value as 'personal' | 'company' })}><option value="personal">立替（自分で支払った）</option><option value="company">会社負担（会社カード等）</option></select></div>
            </div>
            {form.payment_method === 'personal' && <p className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">承認後、立替金の返金対象になります。</p>}
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
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setForm(null)}>閉じる</button><button className={btnPrimary} disabled={saving} onClick={save}>{saving ? '送信中…' : form.id ? '更新して申請' : '申請する'}</button></div>
        </Modal>
      )}
    </div>
  );
}
