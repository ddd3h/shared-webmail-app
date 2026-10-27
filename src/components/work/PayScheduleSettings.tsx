'use client';
import { useCallback, useEffect, useState } from 'react';
import { Notice, api, btnPrimary, inp } from './ui';
import { OFFSET_LABEL, SHIFT_LABEL, dayLabel, describeSchedule, shortDate, closingDate, payDate, periodOf, type PaySchedule, type PayDayShift } from '@/lib/pay-schedule';
import { usesReports, type WorkerType } from '@/lib/work';

type Row = PaySchedule & { worker_type: WorkerType; label: string; custom: boolean; summary: string; example: { period: string; start: string; closing_date: string; pay_date: string } };
type Form = Record<string, string>;
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
const toForm = (r: PaySchedule): Form => ({ closing_day: String(r.closing_day), pay_month_offset: String(r.pay_month_offset), pay_day: String(r.pay_day), pay_day_shift: r.pay_day_shift, report_deadline_days: String(r.report_deadline_days), expense_deadline_days: String(r.expense_deadline_days) });
const fromForm = (f: Form): PaySchedule => ({ closing_day: Number(f.closing_day), pay_month_offset: Number(f.pay_month_offset), pay_day: Number(f.pay_day), pay_day_shift: f.pay_day_shift as PayDayShift, report_deadline_days: Number(f.report_deadline_days), expense_deadline_days: Number(f.expense_deadline_days) });

const DayOptions = () => <><option value={0}>末日</option>{DAYS.map(d => <option key={d} value={d}>{d}日</option>)}</>;

// 締め日・振込日 of each kind of worker (役員 / 正社員 / … / 業務委託). Pay statements, expense claims and 業務報告書 are worked out from these.
export default function PayScheduleSettings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/work/schedules');
    if (!res.ok) return;
    const d = await res.json();
    setRows(d.items); setForms(Object.fromEntries(d.items.map((r: Row) => [r.worker_type, toForm(r)])));
  }, []);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  async function save(r: Row) {
    setSaving(r.worker_type);
    try {
      const res = await api(`/api/work/schedules/${r.worker_type}`, 'PUT', fromForm(forms[r.worker_type]));
      if (res.ok) { flash('success', `${r.label}の締め日・振込日を保存しました`); await load(); } else flash('error', '保存できませんでした。日付と日数を確認してください');
    } finally { setSaving(null); }
  }
  const set = (t: string, k: string, v: string) => setForms(f => ({ ...f, [t]: { ...f[t], [k]: v } }));

  if (!rows) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">区分ごとに、給与・報酬の締め日と振込日、経費と業務報告書の提出期限を決めます。期限までに出した分はその期間の締めに入り、過ぎた分は次の期間（1回分遅れた支払い）になります。土日の振込日だけ前後に動かせます（祝日は考慮しません）。</p>
      <Notice msg={msg} />
      <div className="space-y-3">
        {rows.map(r => {
          const f = forms[r.worker_type] ?? toForm(r);
          const s = fromForm(f);
          const period = periodOf(today, s);
          const changed = JSON.stringify(f) !== JSON.stringify(toForm(r));
          const reports = usesReports(r.worker_type);
          return (
            <section key={r.worker_type} aria-label={`${r.label}の締め日・振込日`} className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{r.label}</h3>
                <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{r.custom ? '設定済み' : '初期値'}</span>
                <span className="text-xs text-gray-500">{describeSchedule(s)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div><label className="text-xs text-gray-600" htmlFor={`cl-${r.worker_type}`}>締め日</label>
                  <select id={`cl-${r.worker_type}`} className={inp} value={f.closing_day} onChange={e => set(r.worker_type, 'closing_day', e.target.value)}><DayOptions /></select></div>
                <div><label className="text-xs text-gray-600" htmlFor={`po-${r.worker_type}`}>支払月</label>
                  <select id={`po-${r.worker_type}`} className={inp} value={f.pay_month_offset} onChange={e => set(r.worker_type, 'pay_month_offset', e.target.value)}>{OFFSET_LABEL.map((l, i) => <option key={l} value={i}>{l}</option>)}</select></div>
                <div><label className="text-xs text-gray-600" htmlFor={`pd-${r.worker_type}`}>振込日</label>
                  <select id={`pd-${r.worker_type}`} className={inp} value={f.pay_day} onChange={e => set(r.worker_type, 'pay_day', e.target.value)}><DayOptions /></select></div>
                <div><label className="text-xs text-gray-600" htmlFor={`ps-${r.worker_type}`}>土日のとき</label>
                  <select id={`ps-${r.worker_type}`} className={inp} value={f.pay_day_shift} onChange={e => set(r.worker_type, 'pay_day_shift', e.target.value)}>{(Object.keys(SHIFT_LABEL) as PayDayShift[]).map(k => <option key={k} value={k}>{SHIFT_LABEL[k]}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div><label className="text-xs text-gray-600" htmlFor={`ed-${r.worker_type}`}>経費の申請期限（締め日の何日後まで）</label>
                  <input id={`ed-${r.worker_type}`} type="number" min={0} max={31} className={`${inp} text-right`} value={f.expense_deadline_days} onChange={e => set(r.worker_type, 'expense_deadline_days', e.target.value)} /></div>
                {reports
                  ? <div><label className="text-xs text-gray-600" htmlFor={`rd-${r.worker_type}`}>業務報告書の提出期限（締め日の何日後まで）</label>
                      <input id={`rd-${r.worker_type}`} type="number" min={0} max={31} className={`${inp} text-right`} value={f.report_deadline_days} onChange={e => set(r.worker_type, 'report_deadline_days', e.target.value)} /></div>
                  : <div className="text-xs text-gray-400 self-end pb-2">（業務報告書は、この区分では使いません）</div>}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-xs text-gray-600" data-testid={`example-${r.worker_type}`}>
                  例: {Number(period.slice(5))}月分は {shortDate(closingDate(period, s))} に締め、{shortDate(payDate(period, s))} に振込
                </p>
                <button className={btnPrimary} disabled={!changed || saving === r.worker_type} onClick={() => save(r)}>{saving === r.worker_type ? '保存中…' : '保存'}</button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
