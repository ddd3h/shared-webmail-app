'use client';
import { useEffect, useState } from 'react';
import { Notice, api, btnPrimary, inp } from '@/components/work/ui';

const blank = { client_code: '', client_name: '', bank_code: '', bank_name: '', branch_code: '', branch_name: '', account_type: 'ordinary', account_number: '' };

// The company's own details for the header of every file. Banks give the 委託者コード when 総合振込・給与振込 is contracted.
export default function ZenginSettingsPanel({ admin }: { admin: boolean }) {
  const [d, setD] = useState<Record<string, string>>(blank);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  useEffect(() => { fetch('/api/zengin/settings').then(r => r.json()).then(b => { setConfigured(b.configured); setD({ ...blank, ...b.settings }); }).catch(() => {}); }, []);

  async function save() {
    const res = await api('/api/zengin/settings', 'PUT', d);
    if (res.ok) { setConfigured(true); setMsg({ type: 'success', text: '保存しました' }); }
    else setMsg({ type: 'error', text: '入力を確認してください。委託者コードは10桁、銀行コードは4桁、支店コードは3桁、委託者名はカナ・英数字で入力します' });
  }

  if (configured === null) return <p className="text-sm text-gray-400">読み込み中…</p>;
  if (!admin) return <p className="text-sm text-gray-600">{configured ? '委託者情報は設定済みです。変更は管理者が行います。' : '委託者情報が未設定です。管理者に設定を依頼してください。'}</p>;
  return (
    <div className="max-w-xl rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-gray-900">委託者情報（振込元）</h3>
        {configured ? <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">設定済み</span> : <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">未設定</span>}</div>
      <p className="text-xs text-gray-500">全銀データのヘッダに入る、会社側の情報です。委託者コードは銀行と総合振込・給与振込の契約をしたときに割り当てられる10桁の番号です。</p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs text-gray-600">委託者コード（10桁）</label><input className={inp} inputMode="numeric" maxLength={10} value={d.client_code} onChange={set('client_code')} /></div>
        <div><label className="text-xs text-gray-600">委託者名（カナ）</label><input className={inp} placeholder="カ）サンプル" value={d.client_name} onChange={set('client_name')} /></div>
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div><label className="text-xs text-gray-600">取引銀行名</label><input className={inp} placeholder="みずほ銀行" value={d.bank_name} onChange={set('bank_name')} /></div>
        <div><label className="text-xs text-gray-600">銀行コード</label><input className={inp} inputMode="numeric" maxLength={4} value={d.bank_code} onChange={set('bank_code')} /></div>
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div><label className="text-xs text-gray-600">支店名</label><input className={inp} placeholder="本店" value={d.branch_name} onChange={set('branch_name')} /></div>
        <div><label className="text-xs text-gray-600">支店コード</label><input className={inp} inputMode="numeric" maxLength={3} value={d.branch_code} onChange={set('branch_code')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs text-gray-600">預金種目</label><select className={inp} value={d.account_type} onChange={set('account_type')}><option value="ordinary">普通</option><option value="checking">当座</option><option value="savings">貯蓄</option></select></div>
        <div><label className="text-xs text-gray-600">口座番号</label><input className={inp} inputMode="numeric" maxLength={7} value={d.account_number} onChange={set('account_number')} /></div>
      </div>
      <Notice msg={msg} />
      <div className="flex justify-end"><button className={btnPrimary} onClick={save}>保存</button></div>
    </div>
  );
}
