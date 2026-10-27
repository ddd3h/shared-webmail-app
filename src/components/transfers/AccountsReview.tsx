'use client';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp } from '@/components/work/ui';
import { TYPE_LABEL, type WorkerType } from '@/components/work/ui';
import { ACCOUNT_TYPE_LABEL, type AccountType } from '@/lib/payment';

type Item = {
  user: { id: string; name: string; worker_type: WorkerType };
  account: null | { bank_name: string; bank_code: string; branch_name: string; branch_code: string; account_type: AccountType; account_number: string; account_holder: string; verified: boolean; revision: string };
};

const VERIFY_ERRORS: Record<string, string> = {
  self_verify: '自分の口座は、他の経理担当・管理者が確認してください',
  self_verify_change: '自分が変更した口座は、他の経理担当・管理者が確認してください',
  changed: '確認している間に口座が変更されました。内容を見直してからもう一度押してください',
};
async function verifyError(res: Response) {
  const e = await res.json().catch(() => ({}));
  return VERIFY_ERRORS[e.error] ?? '確認できませんでした';
}

type Form = { bank_name: string; bank_code: string; branch_name: string; branch_code: string; account_type: AccountType; account_number: string; account_holder: string };
const blank: Form = { bank_name: '', bank_code: '', branch_name: '', branch_code: '', account_type: 'ordinary', account_number: '', account_holder: '' };
const FORMAT_HELP = '入力を確認してください。銀行コードは4桁、支店コードは3桁、口座番号は4〜7桁の数字、口座名義は全角カタカナ・英大文字・数字です';

// Finance staff register or change somebody's account for them (a typo, a person who cannot do it themself).
function EditModal({ user, account, onClose, onSaved }: { user: Item['user']; account: Item['account']; onClose: () => void; onSaved: (text: string) => void }) {
  const [d, setD] = useState<Form>(account ? { bank_name: account.bank_name, bank_code: account.bank_code, branch_name: account.branch_name, branch_code: account.branch_code, account_type: account.account_type, account_number: account.account_number, account_holder: account.account_holder } : blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await api(`/api/bank-accounts/${user.id}`, 'PUT', d);
      if (res.ok) { onSaved(`${user.name}さんの口座を保存しました。他の経理担当・管理者が確認すると、振込の対象になります`); return; }
      const e = await res.json().catch(() => ({}));
      setErr(e.error === 'invalid_body' ? FORMAT_HELP : e.error === 'reauth_required' ? '安全のため、もう一度ログインしてから操作してください' : '保存できませんでした');
    } finally { setBusy(false); }
  }
  return (
    <Modal title={`${user.name}さんの口座`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500">本人に代わって登録・変更します。変更すると「確認済」が外れ、本人に通知が届きます。変更した人は、その口座を確認済にできません（他の経理担当・管理者が確認します）。</p>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <div><label className="text-xs text-gray-600" htmlFor="ba-bank">銀行名</label><input id="ba-bank" className={inp} value={d.bank_name} onChange={set('bank_name')} /></div>
          <div><label className="text-xs text-gray-600" htmlFor="ba-bank-code">銀行コード</label><input id="ba-bank-code" className={inp} inputMode="numeric" maxLength={4} value={d.bank_code} onChange={set('bank_code')} /></div>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <div><label className="text-xs text-gray-600" htmlFor="ba-branch">支店名</label><input id="ba-branch" className={inp} value={d.branch_name} onChange={set('branch_name')} /></div>
          <div><label className="text-xs text-gray-600" htmlFor="ba-branch-code">支店コード</label><input id="ba-branch-code" className={inp} inputMode="numeric" maxLength={3} value={d.branch_code} onChange={set('branch_code')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-600" htmlFor="ba-type">預金種目</label>
            <select id="ba-type" className={inp} value={d.account_type} onChange={set('account_type')}>{(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}</select></div>
          <div><label className="text-xs text-gray-600" htmlFor="ba-number">口座番号</label><input id="ba-number" className={inp} inputMode="numeric" maxLength={7} value={d.account_number} onChange={set('account_number')} /></div>
        </div>
        <div><label className="text-xs text-gray-600" htmlFor="ba-holder">口座名義（カナ）</label><input id="ba-holder" className={inp} placeholder="ヤマダ タロウ" value={d.account_holder} onChange={set('account_holder')} /></div>
        {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      </div>
      <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={onClose}>閉じる</button><button className={btnPrimary} disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button></div>
    </Modal>
  );
}

// Finance staff check each person's receiving account (against a bank book or similar) before it can be used in a file.
export default function AccountsReview({ meId }: { meId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/bank-accounts'); if (r.ok) setItems((await r.json()).items); }, []);
  useEffect(() => { load(); }, [load]);

  // `revision` is the version of the account on screen: if the owner changed it meanwhile, the server refuses
  async function verify(id: string, revision: string) {
    const res = await api(`/api/bank-accounts/${id}/verify`, 'POST', { revision });
    if (res.ok) setMsg({ type: 'success', text: '確認済にしました' });
    else setMsg({ type: 'error', text: await verifyError(res) });
    load();
  }

  async function remove(it: Item) {
    if (!confirm(`${it.user.name}さんの口座を削除しますか？（あとからもう一度登録できます）`)) return;
    const res = await api(`/api/bank-accounts/${it.user.id}`, 'DELETE');
    setMsg(res.ok ? { type: 'success', text: `${it.user.name}さんの口座を削除しました` } : { type: 'error', text: '削除できませんでした' });
    load();
  }

  if (!items) return <p className="text-sm text-gray-400">読み込み中…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">本人が登録した受取口座です。通帳やキャッシュカードの写しなどと照合してから「確認済にする」を押してください。確認済の口座だけが給与振込の対象になります。管理者・経理担当は、全員の口座を登録・変更・削除できます（本人に通知され、変更した人以外が確認します）。</p>
      <Notice msg={msg} />
      <div className="space-y-2">
        {items.map(({ user, account: a }) => (
          <div key={user.id} className="rounded-xl border border-gray-200 bg-white p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900">{user.name} <span className="text-xs font-normal text-gray-400">{TYPE_LABEL[user.worker_type]}{user.id === meId ? ' ・ 自分' : ''}</span></div>
              {a ? (
                <div className="mt-0.5 text-xs text-gray-600">
                  {a.bank_name}（{a.bank_code}）/ {a.branch_name}（{a.branch_code}）/ {ACCOUNT_TYPE_LABEL[a.account_type]} <span className="font-mono tabular-nums">{a.account_number}</span> / {a.account_holder}
                </div>
              ) : <div className="mt-0.5 text-xs text-gray-400">口座が登録されていません</div>}
            </div>
            {a && (a.verified
              ? <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">確認済</span>
              : <button className={btnPrimary} onClick={() => verify(user.id, a.revision)}>確認済にする</button>)}
            {!a && <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">未登録</span>}
            <div className="flex gap-3 text-xs">
              <button className="text-blue-600 hover:underline" aria-label={`${user.name}の口座を${a ? '編集' : '登録'}`} onClick={() => setEditing({ user, account: a })}>{a ? '編集' : '登録'}</button>
              {a && <button className="text-red-600 hover:underline" aria-label={`${user.name}の口座を削除`} onClick={() => remove({ user, account: a })}>削除</button>}
            </div>
          </div>
        ))}
      </div>
      {editing && <EditModal user={editing.user} account={editing.account} onClose={() => setEditing(null)} onSaved={text => { setEditing(null); setMsg({ type: 'success', text }); load(); }} />}
    </div>
  );
}
