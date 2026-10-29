'use client';
import { useCallback, useEffect, useState } from 'react';
import { Notice, Stat, btn, btnPrimary, currentMonth, MonthNav, yen } from '@/components/work/ui';
import { dateLabel } from '@/components/work/ui';
import CreateBatchModal from './CreateBatchModal';

type Ref = { type: 'payslip' | 'payment' | 'expense'; ids: string[] };
type Line = { id: string; who: string; title: string; amount: number; batched: boolean; blocker: string | null; sub: string; pay_date?: string | null; ref?: Ref; label?: string; date?: string; overdue?: boolean; slot?: number | null };
type Flash = { type: 'success' | 'error'; text: string } | null;

// ---- data: one function per source, each returns the same Line shape ----

async function fetchPaymentLines(): Promise<Line[]> {
  const res = await fetch('/api/payments?scope=all&status=approved');
  if (!res.ok) return [];
  return (await res.json()).items.map((r: any): Line => ({
    id: r.id, who: r.vendor.name, title: r.title, amount: r.transfer_amount, batched: !!r.batch_id,
    blocker: r.vendor.verified ? null : '口座未確認', sub: `期日 ${dateLabel(r.due_date)} ・ 申請者 ${r.user.name}`,
    label: r.transfer_day ? `${r.transfer_day}日振込` : undefined, date: r.transfer_date ?? undefined, overdue: r.transfer_late, pay_date: r.transfer_date,
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

// Everything to be transferred in the month, from every source: one file for all of it.
async function fetchMonthlyLines(month: string): Promise<{ lines: Line[]; totals: Totals | null }> {
  const res = await fetch(`/api/transfers/monthly?month=${month}`);
  if (!res.ok) return { lines: [], totals: null };
  const d = await res.json();
  return {
    totals: d.totals,
    lines: d.items.map((i: any): Line => ({
      id: i.key, who: i.who, title: i.title, amount: i.amount, batched: i.batched, blocker: i.blocker, sub: i.sub,
      ref: { type: i.type, ids: i.ids }, label: i.type === 'payment' && i.slot ? `${i.kind_label}（${i.slot}日振込）` : i.kind_label, date: i.scheduled_date, overdue: i.overdue, pay_date: i.scheduled_date, slot: i.slot,
    })),
  };
}
type Totals = { payroll: number; payment: number; expense: number; all: number };

// Shared list for the ways of making a file: approved payment requests, or the month's pay statements.
export default function TransferList({ kind, onCreated }: { kind: 'payment' | 'payroll' | 'monthly'; onCreated: (id: string, fileName: string) => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [lines, setLines] = useState<Line[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<Flash>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [slot, setSlot] = useState<'all' | 15 | 25>('all'); // monthly: which 振込日 to show

  const load = useCallback(async () => {
    if (kind === 'monthly') { const r = await fetchMonthlyLines(month); setLines(r.lines); setTotals(r.totals); }
    else setLines(kind === 'payment' ? await fetchPaymentLines() : await fetchPayrollLines(month));
    setSelected(new Set());
  }, [kind, month]);
  useEffect(() => { setLines(null); load(); }, [load]);

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const shown = (lines ?? []).filter(l => slot === 'all' || l.slot === slot);
  const ready = shown.filter(l => !l.blocker && !l.batched);
  const picked = shown.filter(l => selected.has(l.id));
  const total = picked.reduce((s, l) => s + l.amount, 0);
  const unit = kind === 'payroll' ? '給与' : kind === 'monthly' ? '振込' : '支払';

  return (
    <div className="space-y-3">
      {kind !== 'payment' && <MonthNav month={month} onChange={setMonth} />}
      {kind === 'monthly' && <p className="text-xs text-gray-500">{Number(month.slice(5))}月末までに振り込む、給与・賞与・業務委託費・役員報酬・振込申請・経費の立替金を、1つの全銀データ（総合振込）にまとめます。期日や振込日が過ぎている未払いも入ります。</p>}
      {kind === 'monthly' && lines && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="振込日で絞り込む">
          {([['all', 'すべて'], [15, '15日振込'], [25, '25日振込']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={slot === k} onClick={() => { setSlot(k); setSelected(new Set()); }}
              className={`rounded-full border px-3 py-1 text-xs ${slot === k ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{l}</button>
          ))}
          <span className="text-xs text-gray-500">振込申請は、期日に間に合う15日か25日の振込に自動で振り分けます（土日は前の平日）</span>
        </div>
      )}
      {lines && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label={`${unit}待ち`} value={`${shown.length}件`} sub={yen(shown.reduce((s, l) => s + l.amount, 0))} />
          <Stat label="すぐ作成できる" value={`${ready.length}件`} sub={yen(ready.reduce((s, l) => s + l.amount, 0))} />
          <Stat label="対応が必要" value={`${shown.filter(l => l.blocker).length}件`} sub="口座の未登録・未確認" />
        </div>
      )}
      {kind === 'monthly' && totals && lines && lines.length > 0 && (
        <p className="text-xs text-gray-600" data-testid="monthly-totals">給与・報酬等 {yen(totals.payroll)} ・ 振込申請 {yen(totals.payment)} ・ 経費 {yen(totals.expense)} ・ 合計 <b className="tabular-nums">{yen(totals.all)}</b></p>
      )}
      <Notice msg={msg} />
      {lines === null && <p className="text-sm text-gray-400">読み込み中…</p>}
      {lines && shown.length === 0 && <p className="text-sm text-gray-400">{kind === 'payroll' ? 'この月の支払予定の明細はありません' : kind === 'monthly' ? 'この月に振り込むものはありません' : '振込待ちの申請はありません'}</p>}
      {lines && shown.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button className="text-blue-600 hover:underline" onClick={() => setSelected(new Set(ready.map(l => l.id)))}>作成できるものをすべて選択</button>
            <button className="text-gray-500 hover:underline" onClick={() => setSelected(new Set())}>選択解除</button>
            <div className="flex-1" />
            <span className="text-gray-600">選択中 {selected.size}件 ・ <b className="tabular-nums">{yen(total)}</b></span>
            <button className={btnPrimary} disabled={selected.size === 0} onClick={() => setCreating(true)}>全銀データを作成…</button>
          </div>
          <div className="space-y-2">
            {shown.map(l => (
              <label key={l.id} className={`flex items-start gap-3 rounded-xl border bg-white p-3 ${l.blocker ? 'border-amber-200' : 'border-gray-200'}`}>
                <input type="checkbox" className="mt-1 h-4 w-4" checked={selected.has(l.id)} disabled={!!l.blocker} onChange={() => toggle(l.id)} aria-label={`${l.who} ${l.title}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 wrap-break-word">{l.who} <span className="font-normal text-gray-400">/</span> {l.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    {l.label && <span className="rounded-sm bg-blue-50 px-1.5 py-0.5 text-blue-700">{l.label}</span>}
                    {l.date && <span className={l.overdue ? 'text-red-600' : ''}>{l.ref?.type === 'payment' || kind === 'payment' ? `${l.overdue ? '期日に間に合わず ' : ''}振込予定 ` : l.overdue ? '期日超過 ' : '振込予定 '}{l.date.slice(5).replace('-', '/')}</span>}
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
        <CreateBatchModal kind={kind} ids={[...selected]} items={kind === 'monthly' ? picked.map(l => l.ref!) : undefined} total={total} suggestedDate={picked.map(l => l.pay_date).filter((d): d is string => !!d).sort()[0]} hasBatched={picked.some(l => l.batched)} onClose={() => setCreating(false)}
          onCreated={(id, name) => { setCreating(false); setMsg({ type: 'success', text: `全銀データを作成しました（${name}）。「作成履歴」からダウンロードできます` }); onCreated(id, name); load(); }} />
      )}
    </div>
  );
}
