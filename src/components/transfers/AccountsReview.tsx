'use client';
import { useCallback, useEffect, useState } from 'react';
import { Notice, api, btnPrimary } from '@/components/work/ui';
import { TYPE_LABEL, type WorkerType } from '@/components/work/ui';
import { ACCOUNT_TYPE_LABEL, type AccountType } from '@/lib/payment';

type Item = {
  user: { id: string; name: string; worker_type: WorkerType };
  account: null | { bank_name: string; bank_code: string; branch_name: string; branch_code: string; account_type: AccountType; account_number: string; account_holder: string; verified: boolean; revision: string };
};

const VERIFY_ERRORS: Record<string, string> = {
  self_verify: '自分の口座は、他の経理担当・管理者が確認してください',
  changed: '確認している間に口座が変更されました。内容を見直してからもう一度押してください',
};
async function verifyError(res: Response) {
  const e = await res.json().catch(() => ({}));
  return VERIFY_ERRORS[e.error] ?? '確認できませんでした';
}

// Finance staff check each person's receiving account (against a bank book or similar) before it can be used in a file.
export default function AccountsReview({ meId }: { meId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/bank-accounts'); if (r.ok) setItems((await r.json()).items); }, []);
  useEffect(() => { load(); }, [load]);

  // `revision` is the version of the account on screen: if the owner changed it meanwhile, the server refuses
  async function verify(id: string, revision: string) {
    const res = await api(`/api/bank-accounts/${id}/verify`, 'POST', { revision });
    if (res.ok) setMsg({ type: 'success', text: '確認済にしました' });
    else setMsg({ type: 'error', text: await verifyError(res) });
    load();
  }

  if (!items) return <p className="text-sm text-gray-400">読み込み中…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">本人が登録した受取口座です。通帳やキャッシュカードの写しなどと照合してから「確認済にする」を押してください。確認済の口座だけが給与振込の対象になります。</p>
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
              ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">確認済</span>
              : <button className={btnPrimary} onClick={() => verify(user.id, a.revision)}>確認済にする</button>)}
            {!a && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">未登録</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
