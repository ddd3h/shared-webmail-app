'use client';
import { useState } from 'react';
import { Modal, api, btn, btnPrimary, inp } from '@/components/work/ui';
import type { Vendor } from './shared';

export type VendorDraft = {
  id?: string; name: string; name_kana: string; bank_name: string; bank_code: string; branch_name: string; branch_code: string;
  account_type: 'ordinary' | 'checking' | 'savings'; account_number: string; account_holder: string; notes: string;
};
export const blankVendor = (): VendorDraft => ({ name: '', name_kana: '', bank_name: '', bank_code: '', branch_name: '', branch_code: '', account_type: 'ordinary', account_number: '', account_holder: '', notes: '' });
export const draftFromVendor = (v: Vendor): VendorDraft => ({
  id: v.id, name: v.name, name_kana: v.name_kana ?? '', bank_name: v.bank_name, bank_code: v.bank_code ?? '', branch_name: v.branch_name, branch_code: v.branch_code ?? '',
  account_type: v.account_type, account_number: v.account_number ?? '', account_holder: v.account_holder ?? '', notes: v.notes ?? '',
});

// Register (anyone) or edit (admin) a payee. A change to the bank details clears the "口座確認済" mark.
export default function VendorForm({ initial, admin, onClose, onSaved }: { initial: VendorDraft; admin: boolean; onClose: () => void; onSaved: (id: string, msg: string) => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof VendorDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  async function save() {
    setSaving(true); setError('');
    try {
      const res = d.id ? await api(`/api/payments/vendors/${d.id}`, 'PUT', d) : await api('/api/payments/vendors', 'POST', d);
      if (res.ok) {
        const b = await res.json();
        onSaved(d.id ?? b.id, d.id ? (b.verification_cleared ? '保存しました（口座情報が変わったため、確認済が外れました）' : '保存しました') : admin ? '取引先を登録しました' : '取引先を登録しました（管理者が口座を確認するまで、承認はされません）');
        return;
      }
      const e = await res.json().catch(() => ({}));
      setError(e.error === 'duplicate_vendor' ? `同じ口座がすでに「${e.name}」として登録されています` : '保存に失敗しました。口座番号は4〜8桁の数字、銀行コードは4桁、支店コードは3桁で入力してください');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={d.id ? '取引先を編集' : '取引先を登録'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-600">取引先名</label><input className={inp} placeholder="株式会社A" value={d.name} onChange={set('name')} /></div>
          <div><label className="text-xs text-gray-600">フリガナ（任意）</label><input className={inp} value={d.name_kana} onChange={set('name_kana')} /></div>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <div><label className="text-xs text-gray-600">銀行名</label><input className={inp} placeholder="みずほ銀行" value={d.bank_name} onChange={set('bank_name')} /></div>
          <div><label className="text-xs text-gray-600">銀行コード</label><input className={inp} inputMode="numeric" maxLength={4} placeholder="0001" value={d.bank_code} onChange={set('bank_code')} /></div>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <div><label className="text-xs text-gray-600">支店名</label><input className={inp} placeholder="新宿支店" value={d.branch_name} onChange={set('branch_name')} /></div>
          <div><label className="text-xs text-gray-600">支店コード</label><input className={inp} inputMode="numeric" maxLength={3} placeholder="123" value={d.branch_code} onChange={set('branch_code')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-600">預金種目</label>
            <select className={inp} value={d.account_type} onChange={set('account_type')}><option value="ordinary">普通</option><option value="checking">当座</option><option value="savings">貯蓄</option></select></div>
          <div><label className="text-xs text-gray-600">口座番号</label><input className={inp} inputMode="numeric" maxLength={8} placeholder="1234567" value={d.account_number} onChange={set('account_number')} /></div>
        </div>
        <div><label className="text-xs text-gray-600">口座名義（カナ）</label><input className={inp} placeholder="カ）エー" value={d.account_holder} onChange={set('account_holder')} /></div>
        <div><label className="text-xs text-gray-600">メモ（任意）</label><input className={inp} value={d.notes} onChange={set('notes')} /></div>
        {!admin && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">登録した口座は、管理者が請求書などと照合して「確認済」にするまで、振込の承認ができません。</p>}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button className={btn} onClick={onClose}>閉じる</button>
        <button className={btnPrimary} disabled={saving || !d.name.trim() || !d.bank_name.trim() || !d.branch_name.trim() || !d.account_number || !d.account_holder.trim()} onClick={save}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </Modal>
  );
}
