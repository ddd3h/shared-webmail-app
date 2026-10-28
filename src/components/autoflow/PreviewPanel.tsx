'use client';
import { useState } from 'react';
import { btn, btnPrimary, Notice } from '@/components/work/ui';
import { RULE_LABEL, STAGE_LABEL } from './labels';

type Item = { rule: string; stage: string; user_id: string; user_name: string; title: string; text: string; already_sent: boolean };
type Draft = { user_id: string; user_name: string; month: string; label: string; amount: number; status: 'new' | 'exists' | 'conflict' };
type Result = { dry: boolean; today: string; planned: number; sent: number; skipped: number; delivered: number; items: Item[]; drafts: Draft[] };

// 「今日送るはずの通知」を、送らずに見る。確かめたら、その場で送ることもできる。
export default function PreviewPanel({ onSent }: { onSent: () => void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function run(dry: boolean) {
    if (!dry && !confirm('いま送る予定の通知を、Mattermostに送ります（送信済みのものは送りません）。よろしいですか？')) return;
    setBusy(true); setMsg(null);
    const res = await fetch('/api/autoflow/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry }) });
    setBusy(false);
    if (!res.ok) { setMsg({ type: 'error', text: '実行できませんでした' }); return; }
    const d: Result = await res.json();
    setResult(d);
    if (!dry) { setMsg({ type: 'success', text: `${d.sent}件を送りました（Mattermostに届いたのは${d.delivered}件。届かなかった分はアプリ内の通知だけです）` }); onSent(); }
  }

  const todo = result?.items.filter(i => !i.already_sent) ?? [];
  const newDrafts = result?.drafts?.filter(d => d.status === 'new') ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">ONにした流れについて、今日（日本時間）送ることになる通知を確かめます。ここで見るだけでは何も送りません。</p>
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={() => run(true)} disabled={busy}>{busy ? '確認中…' : '今日送る通知を確認'}</button>
        <button className={btnPrimary} onClick={() => run(false)} disabled={busy || todo.length + newDrafts.length === 0}>確認した通知を今すぐ送る（{todo.length}件{newDrafts.length > 0 ? `・下書き${newDrafts.length}件を作る` : ''}）</button>
      </div>
      <Notice msg={msg} />
      {result && (
        <div className="space-y-2">
          <p className="text-sm text-gray-700">{result.today}: 送る予定 {result.planned}件（うち送信済み {result.items.filter(i => i.already_sent).length}件）</p>
          {(result.drafts?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-2.5 text-sm space-y-1">
              <p className="text-xs font-semibold text-gray-700">固定報酬の下書き（{result.drafts.filter(d => d.status === 'new').length}件を作る）</p>
              {result.drafts.map(d => (
                <p key={`${d.user_id}${d.month}`} className="text-xs text-gray-600">{d.user_name}・{d.month}分・{d.label} ¥{d.amount.toLocaleString('ja-JP')}　{d.status === 'new' ? '→ 作る' : d.status === 'exists' ? '（作成済み）' : '（作らない: その月の明細がすでにある）'}</p>
              ))}
            </div>
          )}
          {result.items.length === 0 && <p className="text-sm text-gray-400">今日送る通知はありません（ONの流れがない、または期限の日ではありません）</p>}
          <ul className="space-y-1.5">
            {result.items.map((i, n) => (
              <li key={`${i.rule}${i.stage}${i.user_id}${n}`} className="rounded-xl border border-gray-200 bg-white p-2.5 text-sm">
                <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === n ? null : n)} aria-expanded={open === n}>
                  <span className="rounded-sm bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{RULE_LABEL[i.rule] ?? i.rule}</span>
                  <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{STAGE_LABEL[i.stage] ?? i.stage}</span>
                  <span className="font-medium text-gray-900">{i.user_name}</span>
                  <span className="text-xs text-gray-500 flex-1 min-w-40 truncate">{i.title}</span>
                  {i.already_sent && <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">送信済み</span>}
                </button>
                {open === n && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs text-gray-700 font-sans">{i.text}</pre>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
