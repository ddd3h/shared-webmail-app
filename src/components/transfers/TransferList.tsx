'use client';
import { useCallback, useEffect, useState } from 'react';
import { Notice, Stat, btn, btnPrimary, currentMonth, MonthNav, yen } from '@/components/work/ui';
import { dateLabel } from '@/components/work/ui';
import CreateBatchModal from './CreateBatchModal';

type Line = { id: string; who: string; title: string; amount: number; batched: boolean; blocker: string | null; sub: string; pay_date?: string | null };
type Flash = { type: 'success' | 'error'; text: string } | null;

// ---- data: one function per source, each returns the same Line shape ----

async function fetchPaymentLines(): Promise<Line[]> {
  const res = await fetch('/api/payments?scope=all&status=approved');
  if (!res.ok) return [];
  return (await res.json()).items.map((r: any): Line => ({
    id: r.id, who: r.vendor.name, title: r.title, amount: r.transfer_amount, batched: !!r.batch_id,
    blocker: r.vendor.verified ? null : '口座未確認', sub: `期日 ${dateLabel(r.due_date)} ・ 申請者 ${r.user.name}`,
  }));
}

/** Why a statement can't go into a file yet, or null when it can. */
function payslipBlocker(p: any): string | null {
  if (!p.account.registered) return '受取口座が未登録';
  if (!p.account.verified) return '受取口座が未確認';
  return p.net <= 0 ? '支給額が0円以下' : null;
}

async function fetchPayrollLines(month: string): Promise<Line[]> {
  const res = await fetch(`/api/transfers/payroll?month=${month}`);
  if (!res.ok) return [];
  return (await res.json()).items.filter((p: any) => p.status === 'planned').map((p: any): Line => ({
    id: p.id, who: p.user.name, title: p.title, amount: p.net, batched: !!p.batch_id, blocker: payslipBlocker(p), pay_date: p.pay_date,
    sub: p.account.registered ? `${p.account.bank_name} ${p.account.branch_name} ****${p.account.last4}` : '口座なし',
  }));
}

// Shared list for the two ways of making a file: approved payment requests, or the month's pay statements.
export default function TransferList({ kind, onCreated }: { kind: 'payment' | 'payroll'; onCreated: (id: string, fileName: string) => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [lines, setLines] = useState<Line[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<Flash>(null);

  const load = useCallback(async () => {
    setLines(kind === 'payment' ? await fetchPaymentLines() : await fetchPayrollLines(month));
    setSelected(new Set());
  }, [kind, month]);
  useEffect(() => { setLines(null); load(); }, [load]);

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ready = (lines ?? []).filter(l => !l.blocker && !l.batched);
  const picked = (lines ?? []).filter(l => selected.has(l.id));
  const total = picked.reduce((s, l) => s + l.amount, 0);
  const unit = kind === 'payroll' ? '給与' : '支払';

  return (
    <div className="space-y-3">
      {kind === 'payroll' && <MonthNav month={month} onChange={setMonth} />}
      {lines && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label={`${unit}待ち`} value={`${lines.length}件`} sub={yen(lines.reduce((s, l) => s + l.amount, 0))} />
          <Stat label="すぐ作成できる" value={`${ready.length}件`} sub={yen(ready.reduce((s, l) => s + l.amount, 0))} />
          <Stat label="対応が必要" value={`${lines.filter(l => l.blocker).length}件`} sub="口座の未登録・未確認" />
        </div>
      )}
      <Notice msg={msg} />
      {lines === null && <p className="text-sm text-gray-400">読み込み中…</p>}
      {lines && lines.length === 0 && <p className="text-sm text-gray-400">{kind === 'payroll' ? 'この月の支払予定の明細はありません' : '振込待ちの申請はありません'}</p>}
      {lines && lines.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button className="text-blue-600 hover:underline" onClick={() => setSelected(new Set(ready.map(l => l.id)))}>作成できるものをすべて選択</button>
            <button className="text-gray-500 hover:underline" onClick={() => setSelected(new Set())}>選択解除</button>
            <div className="flex-1" />
            <span className="text-gray-600">選択中 {selected.size}件 ・ <b className="tabular-nums">{yen(total)}</b></span>
            <button className={btnPrimary} disabled={selected.size === 0} onClick={() => setCreating(true)}>全銀データを作成…</button>
          </div>
          <div className="space-y-2">
            {lines.map(l => (
              <label key={l.id} className={`flex items-start gap-3 rounded-xl border bg-white p-3 ${l.blocker ? 'border-amber-200' : 'border-gray-200'}`}>
                <input type="checkbox" className="mt-1 h-4 w-4" checked={selected.has(l.id)} disabled={!!l.blocker} onChange={() => toggle(l.id)} aria-label={`${l.who} ${l.title}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 wrap-break-word">{l.who} <span className="font-normal text-gray-400">/</span> {l.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    <span>{l.sub}</span>
                    {l.blocker && <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-amber-700">{l.blocker}</span>}
                    {l.batched && <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-gray-600">全銀データ作成済み</span>}
                  </div>
                </div>
                <div className="text-base font-bold tabular-nums">{yen(l.amount)}</div>
              </label>
            ))}
          </div>
        </>
      )}
      {creating && (
        <CreateBatchModal kind={kind} ids={[...selected]} total={total} suggestedDate={picked.map(l => l.pay_date).filter((d): d is string => !!d).sort()[0]} hasBatched={picked.some(l => l.batched)} onClose={() => setCreating(false)}
          onCreated={(id, name) => { setCreating(false); setMsg({ type: 'success', text: `全銀データを作成しました（${name}）。「作成履歴」からダウンロードできます` }); onCreated(id, name); load(); }} />
      )}
    </div>
  );
}
