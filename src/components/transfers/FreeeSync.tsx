'use client';
import { useCallback, useEffect, useState } from 'react';
import { Notice, Stat, api, btn, btnPrimary, yen } from '@/components/work/ui';

type Row = { id: string; source_type: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'; amount: number; paid_date: string; description: string; freee_deal_id: number | null; error: string | null; attempts: number };
type Waiting = { source_type: string; source_id: string; date: string; amount: number; description: string };
type Data = { connected: boolean; ready: boolean; auto_sync: boolean; sync_from: string | null; company: string | null; counts: { sent: number; failed: number; skipped: number; waiting: number }; waiting: Waiting[]; items: Row[] };

const TYPE_LABEL: Record<string, string> = { payslip: '給与・報酬', payment: '振込申請', expense: '経費' };
const STATUS: Record<Row['status'], [string, string]> = {
  sent: ['送信済み', 'bg-emerald-100 text-emerald-700'], failed: ['失敗', 'bg-red-100 text-red-700'], pending: ['送信待ち', 'bg-amber-100 text-amber-700'],
  sending: ['送信中', 'bg-blue-100 text-blue-700'], skipped: ['送らない', 'bg-gray-100 text-gray-600'],
};

// What was sent to freee, what failed and what is waiting. Settings (connecting, accounts) are the administrator's, in 管理 › システム設定.
export default function FreeeSync() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/freee/exports'); if (r.ok) setD(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 6000); }

  async function sync() {
    setBusy(true);
    try {
      const r = await api('/api/freee/sync', 'POST');
      const j = await r.json().catch(() => ({}));
      if (r.ok) flash(j.failed ? 'error' : 'success', `${j.sent}件を送りました${j.failed ? `（${j.failed}件は失敗しました。下の一覧で確認してください）` : ''}${j.pending ? `。残り${j.pending}件はもう一度押してください` : ''}`);
      else flash('error', 'freeeの設定が終わっていません。管理者に、システム設定の「freee連携」を依頼してください');
      await load();
    } finally { setBusy(false); }
  }
  async function act(id: string, action: 'retry' | 'skip') {
    const r = await api(`/api/freee/exports/${id}`, 'POST', { action });
    if (r.ok) { flash('success', action === 'retry' ? '送信待ちに戻しました。「今すぐ送る」で送ります' : '送らないことにしました'); await load(); } else flash('error', '操作できませんでした');
  }

  if (!d) return <p className="text-sm text-gray-400">読み込み中…</p>;
  if (!d.ready) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-700" data-testid="freee-not-ready">{d.connected ? 'freeeとの接続は済んでいますが、会社・支払元の口座・連携の開始日がまだ決まっていません。' : 'freeeにはまだ接続されていません。'}</p>
        <p className="text-xs text-gray-500">システム管理者が「管理 › システム設定 › freee連携」で設定すると、支払い済みのお金の動きをfreeeに送れるようになります。</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="送信待ち" value={`${d.counts.waiting}件`} sub="支払い済みで、まだ送っていない分" />
        <Stat label="失敗" value={`${d.counts.failed}件`} sub={d.counts.failed ? '内容を確認して再送' : undefined} />
        <Stat label="送信済み" value={`${d.counts.sent}件`} sub={d.company ?? undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>{d.sync_from} 以降に支払ったものが対象 ・ 自動送信: {d.auto_sync ? 'オン' : 'オフ'}</span>
        <div className="flex-1" />
        <button className={btnPrimary} disabled={busy} onClick={sync}>{busy ? '送信中…' : '今すぐ送る'}</button>
      </div>
      <Notice msg={msg} />

      {d.waiting.length > 0 && (
        <section className="space-y-1.5" aria-label="送信待ち">
          <h3 className="text-sm font-semibold text-gray-900">送信待ち</h3>
          {d.waiting.map(w => (
            <div key={`${w.source_type}:${w.source_id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm">
              <span className="rounded-sm bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{TYPE_LABEL[w.source_type]}</span>
              <span className="order-last basis-full text-gray-900 wrap-break-word sm:order-none sm:min-w-0 sm:flex-1 sm:basis-auto">{w.description}</span>
              <span className="ml-auto text-xs text-gray-500">{w.date}</span><span className="font-bold tabular-nums">{yen(w.amount)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-1.5" aria-label="送信の記録">
        <h3 className="text-sm font-semibold text-gray-900">送信の記録</h3>
        {d.items.length === 0 && <p className="text-sm text-gray-400">まだ送っていません</p>}
        {d.items.map(r => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              <span className="rounded-sm bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{TYPE_LABEL[r.source_type]}</span>
              <span className="order-last basis-full text-gray-900 wrap-break-word sm:order-none sm:min-w-0 sm:flex-1 sm:basis-auto">{r.description}</span>
              <span className="ml-auto text-xs text-gray-500">{r.paid_date}</span><span className="font-bold tabular-nums">{yen(r.amount)}</span>
            </div>
            {r.freee_deal_id && <p className="text-xs text-gray-400">freeeの取引ID: {r.freee_deal_id}</p>}
            {r.error && <p className="text-xs text-red-700 bg-red-50 rounded-lg px-2 py-1">{r.error}</p>}
            {r.status === 'failed' && (
              <div className="flex gap-3 text-xs"><button className="text-blue-600 hover:underline" onClick={() => act(r.id, 'retry')}>再送する</button><button className={`${btn} !px-2 !py-0.5 text-xs`} onClick={() => act(r.id, 'skip')}>送らない</button></div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
