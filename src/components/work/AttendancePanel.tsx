'use client';
import { useCallback, useEffect, useState } from 'react';
import { MonthNav, Modal, Notice, Stat, btn, btnPrimary, currentMonth, dateLabel, fmtMin, fmtTime, fromJstInput, inp, toJstInput, api } from './ui';

type Rec = {
  id: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null; break_started_at: string | null;
  break_minutes: number; worked_minutes: number | null; note: string | null; edited: boolean;
};
type Data = {
  user: { id: string; name: string };
  records: Rec[];
  today: { clock_in_at: string | null; clock_out_at: string | null; break_started_at: string | null; allowed: string[] } | null;
  summary: { days: number; workedMinutes: number; overtimeMinutes: number };
  settings: { daily_minutes: number; auto_break_minutes: number };
};

const PUNCH_LABEL: Record<string, string> = { clock_in: '出勤', break_start: '休憩開始', break_end: '休憩終了', clock_out: '退勤' };

// Employees punch in/out here. With `userId` (admin) it shows and corrects that person's records.
export default function AttendancePanel({ userId }: { userId?: string }) {
  const [month, setMonth] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id?: string; work_date: string; in: string; out: string; brk: string; note: string } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { setMonth(currentMonth()); setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    if (!month) return;
    const q = new URLSearchParams({ month, ...(userId ? { userId } : {}) });
    const res = await fetch(`/api/work/attendance?${q}`);
    if (res.ok) setData(await res.json()); else setData(null);
  }, [month, userId]);
  useEffect(() => { load(); }, [load]);

  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  async function punch(action: string) {
    setBusy(true);
    try {
      const res = await api('/api/work/attendance/punch', 'POST', { action });
      if (res.ok) { flash('success', `${PUNCH_LABEL[action]}を記録しました`); await load(); }
      else flash('error', '打刻できませんでした。画面を更新して状態を確認してください');
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!edit || !userId) return;
    const res = await api('/api/work/attendance', 'PUT', {
      userId, work_date: edit.work_date, clock_in_at: fromJstInput(edit.in), clock_out_at: fromJstInput(edit.out),
      break_minutes: Number(edit.brk) || 0, note: edit.note || null,
    });
    if (res.ok) { setEdit(null); flash('success', '保存しました'); load(); } else flash('error', '保存に失敗しました。時刻を確認してください');
  }
  async function remove(id: string) {
    if (!confirm('この日の記録を削除しますか？')) return;
    const res = await api(`/api/work/attendance?id=${id}`, 'DELETE');
    if (res.ok) load(); else flash('error', '削除に失敗しました');
  }

  const t = data?.today;
  const status = !t ? '' : t.clock_out_at ? '退勤済み' : t.break_started_at ? '休憩中' : t.clock_in_at ? '勤務中' : '未出勤';
  const statusColor = status === '勤務中' ? 'bg-emerald-100 text-emerald-700' : status === '休憩中' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';

  return (
    <div className="space-y-4">
      {!userId && t && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-[10rem]">
              <div className="text-xs text-gray-500">{now ? now.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' }) : ''}</div>
              <div className="text-3xl font-bold tabular-nums text-gray-900">{now ? now.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}</div>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>{status}</span>
              {t.clock_in_at && <span className="ml-2 text-xs text-gray-500">出勤 {fmtTime(t.clock_in_at)}{t.clock_out_at ? ` / 退勤 ${fmtTime(t.clock_out_at)}` : ''}</span>}
            </div>
            <div className="flex flex-wrap gap-2 ml-auto">
              {(['clock_in', 'break_start', 'break_end', 'clock_out'] as const).map(a => (
                <button key={a} disabled={busy || !t.allowed.includes(a)} onClick={() => punch(a)}
                  className={`rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-30 ${a === 'clock_in' ? 'bg-blue-600 text-white' : a === 'clock_out' ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-700 bg-white'}`}>
                  {PUNCH_LABEL[a]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {month && <MonthNav month={month} onChange={setMonth} />}
        {userId && data && <span className="text-sm text-gray-600">{data.user.name} さんの勤怠</span>}
        <div className="flex-1" />
        {userId && month && <button className={btn} onClick={() => setEdit({ work_date: `${month}-01`, in: '', out: '', brk: '60', note: '' })}>＋ 日を追加・修正</button>}
      </div>
      <Notice msg={msg} />

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="出勤日数" value={`${data.summary.days}日`} />
            <Stat label="総労働時間" value={fmtMin(data.summary.workedMinutes)} />
            <Stat label="残業時間" value={fmtMin(data.summary.overtimeMinutes)} sub={`所定 ${fmtMin(data.settings.daily_minutes)}/日 超過分`} />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="px-3 py-2 text-left">日付</th><th className="px-3 py-2 text-right">出勤</th><th className="px-3 py-2 text-right">退勤</th><th className="px-3 py-2 text-right">休憩</th><th className="px-3 py-2 text-right">実働</th><th className="px-3 py-2 text-left">備考</th>{userId && <th />}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.records.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">この月の記録はありません</td></tr>}
                {data.records.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{dateLabel(r.work_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtTime(r.clock_in_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.clock_in_at && !r.clock_out_at ? <span className="text-emerald-600">勤務中</span> : fmtTime(r.clock_out_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.break_minutes ? `${r.break_minutes}分` : '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMin(r.worked_minutes)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-normal min-w-[8rem]">{r.edited && <span className="mr-1 rounded bg-amber-50 px-1 text-amber-700">修正済</span>}{r.note}</td>
                    {userId && (
                      <td className="px-3 py-2 whitespace-nowrap text-right text-xs">
                        <button className="text-blue-600 hover:underline mr-2" onClick={() => setEdit({ id: r.id, work_date: r.work_date, in: toJstInput(r.clock_in_at), out: toJstInput(r.clock_out_at), brk: String(r.break_minutes), note: r.note || '' })}>修正</button>
                        <button className="text-red-600 hover:underline" onClick={() => remove(r.id)}>削除</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">休憩を打刻しなかった6時間以上の勤務は、自動で{data.settings.auto_break_minutes}分の休憩を差し引いて表示します（管理者が設定できます）。</p>
        </>
      )}

      {edit && (
        <Modal title="勤怠の追加・修正" onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <div><label className="text-xs text-gray-600">日付</label><input type="date" className={inp} value={edit.work_date} disabled={!!edit.id} onChange={e => setEdit({ ...edit, work_date: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">出勤</label><input type="datetime-local" className={inp} value={edit.in} onChange={e => setEdit({ ...edit, in: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">退勤</label><input type="datetime-local" className={inp} value={edit.out} onChange={e => setEdit({ ...edit, out: e.target.value })} /></div>
            </div>
            <div><label className="text-xs text-gray-600">休憩（分）</label><input type="number" min={0} className={inp} value={edit.brk} onChange={e => setEdit({ ...edit, brk: e.target.value })} /></div>
            <div><label className="text-xs text-gray-600">備考（修正理由など）</label><input className={inp} value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setEdit(null)}>閉じる</button><button className={btnPrimary} onClick={saveEdit}>保存</button></div>
        </Modal>
      )}
    </div>
  );
}
