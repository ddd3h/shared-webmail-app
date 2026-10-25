'use client';
import { useEffect, useState } from 'react';
import { Notice, api, btnPrimary, inp } from './ui';
import { ACCOUNT_TYPE_LABEL, type AccountType } from '@/lib/payment';

type Account = {
  bank_name: string; bank_code: string; branch_name: string; branch_code: string; account_type: AccountType;
  account_number: string; account_holder: string; verified: boolean;
};
const HOLDER_HELP = '口座名義は、全銀の振込データに使えるカナ・英数字で入力してください（例: ヤマダ タロウ）。「全銀」の文字種は全角カタカナ・英大文字・数字です';
const FORMAT_HELP = '入力を確認してください。銀行コードは4桁、支店コードは3桁、口座番号は4〜7桁の数字です';
const errorText = (fields: string[]) => (fields.includes('account_holder') ? HOLDER_HELP : FORMAT_HELP);

const blank = { bank_name: '', bank_code: '', branch_name: '', branch_code: '', account_type: 'ordinary' as AccountType, account_number: '', account_holder: '' };

// My own receiving account. Salary and reimbursements are sent here by finance staff, so it has to be one that can go into a 全銀 file.
export default function BankAccountPanel() {
  const [d, setD] = useState(blank);
  const [saved, setSaved] = useState<Account | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  useEffect(() => {
    fetch('/api/bank-accounts/me').then(r => r.json()).then(({ account }) => {
      if (account) { setSaved(account); setD({ bank_name: account.bank_name, bank_code: account.bank_code, branch_name: account.branch_name, branch_code: account.branch_code, account_type: account.account_type, account_number: account.account_number, account_holder: account.account_holder }); }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const res = await api('/api/bank-accounts/me', 'PUT', d);
      if (res.ok) {
        const b = await res.json();
        setSaved(b.account);
        setMsg({ type: 'success', text: b.account.verified ? '変更はありません' : '保存しました。経理担当が内容を確認すると、振込の対象になります' });
      } else {
        const e = await res.json().catch(() => ({}));
        setMsg({ type: 'error', text: errorText(e.fields ?? []) });
      }
    } finally { setSaving(false); }
  }

  if (!loaded) return <p className="text-sm text-gray-400">読み込み中…</p>;
  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">受取口座</h3>
          {saved && (saved.verified
            ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">経理確認済</span>
            : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">確認待ち</span>)}
        </div>
        <p className="text-xs text-gray-500">給与・報酬・経費の立替金を受け取る口座です。登録しておくと、支払日の一括振込にそのまま使われます。口座番号は暗号化して保存され、本人と経理担当だけが見られます。</p>
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
            <select className={inp} value={d.account_type} onChange={set('account_type')}>
              {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600">口座番号</label><input className={inp} inputMode="numeric" maxLength={7} placeholder="1234567" value={d.account_number} onChange={set('account_number')} /></div>
        </div>
        <div><label className="text-xs text-gray-600">口座名義（カナ）</label><input className={inp} placeholder="ヤマダ タロウ" value={d.account_holder} onChange={set('account_holder')} /></div>
        <Notice msg={msg} />
        <div className="flex justify-end">
          <button className={btnPrimary} disabled={saving || !d.bank_name.trim() || !d.branch_name.trim() || !d.account_number || !d.account_holder.trim()} onClick={save}>{saving ? '保存中…' : '保存'}</button>
        </div>
        {saved?.verified && <p className="text-[11px] text-gray-400">口座の内容を変えると「確認済」が外れ、経理担当が改めて確認するまで振込の対象になりません。</p>}
      </div>
    </div>
  );
}
