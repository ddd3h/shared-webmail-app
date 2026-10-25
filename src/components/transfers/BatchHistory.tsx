'use client';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';
import { todayJst } from '@/components/payments/shared';
import { CATEGORY_LABEL, type CategoryCode } from '@/lib/zengin';

type Batch = {
  id: string; kind: 'payment' | 'payroll'; category_code: CategoryCode; transfer_date: string; item_count: number; total_amount: number;
  file_name: string; created_at: string; paid_at: string | null; creator: string | null;
};

export default function BatchHistory({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Batch[] | null>(null);
  const [pay, setPay] = useState<Batch | null>(null);
  const [payDate, setPayDate] = useState(todayJst());
  const [cancel, setCancel] = useState<Batch | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/transfers/batches');
    if (res.ok) setItems((await res.json()).items);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 6000); }

  async function markPaid() {
    if (!pay) return;
    setBusy(true);
    try {
      const res = await api(`/api/transfers/batches/${pay.id}/mark-paid`, 'POST', { paid_date: payDate });
      if (res.ok) { const d = await res.json(); flash('success', `${d.paid}件を${pay.kind === 'payroll' ? '支払済' : '振込済'}にしました`); }
      else flash('error', res.status === 409 ? 'すでに処理済みです' : '処理に失敗しました');
      setPay(null); load();
    } finally { setBusy(false); }
  }
  async function doCancel() {
    if (!cancel) return;
    setBusy(true);
    try {
      const res = await api(`/api/transfers/batches/${cancel.id}`, 'DELETE');
      flash(res.ok ? 'success' : 'error', res.ok ? '取り消しました。対象は再び選べるようになります' : '取り消せませんでした（すでに振込済みの可能性があります）');
      setCancel(null); load();
    } finally { setBusy(false); }
  }

  if (!items) return <p className="text-sm text-gray-400">読み込み中…</p>;
  return (
    <div className="space-y-3">
      <Notice msg={msg} />
      {items.length === 0 && <p className="text-sm text-gray-400">まだ全銀データを作成していません</p>}
      {items.map(b => (
        <div key={b.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">{CATEGORY_LABEL[b.category_code] ?? b.category_code}</span>
            <span className="text-sm font-medium text-gray-900">{b.kind === 'payroll' ? '給与' : '支払'} {b.item_count}件</span>
            <span className="text-sm font-bold tabular-nums">{yen(b.total_amount)}</span>
            <div className="flex-1" />
            {b.paid_at
              ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">{b.paid_at} 振込済</span>
              : <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700">銀行へ送付待ち</span>}
          </div>
          <div className="text-xs text-gray-500">振込指定日 {b.transfer_date} ・ 作成 {new Date(b.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}{b.creator ? `（${b.creator}）` : ''} ・ <span className="font-mono">{b.file_name}</span></div>
          <div className="flex flex-wrap gap-2">
            <a className={btn} href={`/api/transfers/batches/${b.id}/download`} download>ダウンロード</a>
            {!b.paid_at && <button className={btnPrimary} onClick={() => { setPayDate(todayJst()); setPay(b); }}>振込済にする</button>}
            {!b.paid_at && <button className={btn} onClick={() => setCancel(b)}>取り消す</button>}
          </div>
        </div>
      ))}
      {pay && (
        <Modal title="振込済にする" onClose={() => setPay(null)}>
          <p className="text-sm text-gray-700 mb-3">{pay.item_count}件・合計 <b className="tabular-nums">{yen(pay.total_amount)}</b> を一括で{pay.kind === 'payroll' ? '支払済' : '振込済'}にします。銀行にデータを送り、振込が実行されたことを確認してから記録してください。
            {pay.kind === 'payroll' && ' 給与明細に合算した経費の立替金も、あわせて精算済みになります。'}</p>
          <div><label className="text-xs text-gray-600">振込日</label><input type="date" className={inp} value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setPay(null)}>閉じる</button><button className={btnPrimary} disabled={busy || !payDate} onClick={markPaid}>記録する</button></div>
        </Modal>
      )}
      {cancel && (
        <Modal title="全銀データを取り消す" onClose={() => setCancel(null)}>
          <p className="text-sm text-gray-700">{cancel.item_count}件・{yen(cancel.total_amount)} のデータを取り消します。すでに銀行へ送ったファイルは取り消せないので、未送付の場合だけ行ってください。</p>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setCancel(null)}>閉じる</button><button className={btnPrimary} disabled={busy} onClick={doCancel}>取り消す</button></div>
        </Modal>
      )}
    </div>
  );
}
