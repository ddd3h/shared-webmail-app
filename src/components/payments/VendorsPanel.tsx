'use client';
import { useCallback, useEffect, useState } from 'react';
import { Notice, api, btnPrimary } from '@/components/work/ui';
import VendorForm, { blankVendor, draftFromVendor, type VendorDraft } from './VendorForm';
import { AccountInfo, type Vendor } from './shared';

export default function VendorsPanel({ admin, onChanged }: { admin: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<Vendor[]>([]);
  const [form, setForm] = useState<VendorDraft | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/payments/vendors${admin ? '?all=1' : ''}`);
    if (res.ok) setItems((await res.json()).items);
  }, [admin]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 6000); }

  async function verify(v: Vendor) {
    if (!confirm(`「${v.name}」の口座（${v.bank_name} ${v.branch_name} ${v.account_number}）を、請求書・契約書と照合して確認済にしますか？`)) return;
    const res = await api(`/api/payments/vendors/${v.id}/verify`, 'POST');
    if (res.ok) { flash('success', '口座を確認済にしました'); load(); onChanged(); } else flash('error', '確認できませんでした');
  }
  async function remove(v: Vendor) {
    if (!confirm(`「${v.name}」を削除しますか？（申請で使用済みの場合は無効になるだけです）`)) return;
    const res = await api(`/api/payments/vendors/${v.id}`, 'DELETE');
    if (res.ok) { const d = await res.json(); flash('success', d.deactivated ? '使用済みのため無効にしました' : '削除しました'); load(); onChanged(); }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">振込先の取引先と口座です。口座番号は暗号化して保存され、管理者以外には末尾4桁しか表示されません。{admin ? '口座情報を変更すると「確認済」が外れ、再確認するまで承認・振込ができません。' : ''}</p>
      <Notice msg={msg} />
      <div className="flex justify-end"><button className={btnPrimary} onClick={() => setForm(blankVendor())}>＋ 取引先を登録</button></div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-gray-400">取引先はまだ登録されていません</p>}
        {items.map(v => (
          <div key={v.id} className={`rounded-xl border bg-white p-3 space-y-2 ${v.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            <AccountInfo v={v} />
            {!v.is_active && <p className="text-xs text-gray-400">無効（新しい申請では選べません）</p>}
            {admin && (
              <div className="flex flex-wrap gap-3 text-xs">
                {!v.verified && <button className="rounded-sm bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700" onClick={() => verify(v)}>口座を確認済にする</button>}
                <button className="text-blue-600 hover:underline" onClick={() => setForm(draftFromVendor(v))}>編集</button>
                <button className="text-red-600 hover:underline" onClick={() => remove(v)}>削除</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {form && <VendorForm initial={form} admin={admin} onClose={() => setForm(null)} onSaved={(_id, m) => { setForm(null); flash('success', m); load(); onChanged(); }} />}
    </div>
  );
}
