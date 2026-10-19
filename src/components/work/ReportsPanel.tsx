'use client';
import { useCallback, useEffect, useState } from 'react';
import { MonthNav, Modal, Notice, Stat, btn, btnPrimary, currentMonth, dateLabel, inp, api } from './ui';

type Report = { id: string; report_date: string; title: string; content: string; hours: number | null; user?: { id: string; name: string } };
type Draft = { id?: string; report_date: string; title: string; content: string; hours: string };

// Contractors submit their 業務報告書 here. In `admin` mode it lists everyone's reports (read-only, deletable).
export default function ReportsPanel({ admin = false, userId }: { admin?: boolean; userId?: string }) {
  const [month, setMonth] = useState('');
  const [items, setItems] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { setMonth(currentMonth()); }, []);
  const load = useCallback(async () => {
    if (!month) return;
    const q = new URLSearchParams({ month, ...(userId ? { userId } : {}) });
    const res = await fetch(`/api/work/reports?${q}`);
    if (res.ok) { const d = await res.json(); setItems(d.items); setTotal(d.total_hours); }
  }, [month, userId]);
  useEffect(() => { load(); }, [load]);

  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }
  const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  async function save() {
    if (!draft) return;
    const body = { report_date: draft.report_date, title: draft.title, content: draft.content, hours: draft.hours === '' ? null : Number(draft.hours) };
    const res = draft.id ? await api(`/api/work/reports/${draft.id}`, 'PATCH', body) : await api('/api/work/reports', 'POST', body);
    if (res.ok) { setDraft(null); flash('success', '報告書を提出しました'); load(); } else flash('error', '保存に失敗しました。件名と内容を入力してください');
  }
  async function remove(id: string) {
    if (!confirm('この報告書を削除しますか？')) return;
    const res = await api(`/api/work/reports/${id}`, 'DELETE');
    if (res.ok) load(); else flash('error', '削除に失敗しました');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {month && <MonthNav month={month} onChange={setMonth} />}
        <div className="flex-1" />
        {!admin && <button className={btnPrimary} onClick={() => setDraft({ report_date: today(), title: '', content: '', hours: '' })}>＋ 報告書を作成</button>}
      </div>
      <Notice msg={msg} />
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <Stat label="提出件数" value={`${items.length}件`} />
        <Stat label="報告した稼働時間" value={`${total}h`} />
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-gray-400">この月の報告書はありません</p>}
        {items.map(r => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <button className="w-full text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{dateLabel(r.report_date)}</span>{admin && r.user && <span className="rounded bg-gray-100 px-1.5 py-0.5">{r.user.name}</span>}
                {r.hours !== null && <span>{r.hours}h</span>}
              </div>
              <div className="text-sm font-medium text-gray-900 mt-0.5">{r.title}</div>
            </button>
            {open === r.id && (
              <div className="mt-2 border-t border-gray-100 pt-2">
                <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{r.content}</p>
                <div className="mt-2 flex gap-3 text-xs">
                  {!admin && <button className="text-blue-600 hover:underline" onClick={() => setDraft({ id: r.id, report_date: r.report_date, title: r.title, content: r.content, hours: r.hours === null ? '' : String(r.hours) })}>編集</button>}
                  <button className="text-red-600 hover:underline" onClick={() => remove(r.id)}>削除</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {draft && (
        <Modal title={draft.id ? '業務報告書を編集' : '業務報告書を作成'} onClose={() => setDraft(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">対象日</label><input type="date" className={inp} value={draft.report_date} onChange={e => setDraft({ ...draft, report_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">稼働時間（h・任意）</label><input type="number" step="0.25" min={0} className={inp} value={draft.hours} onChange={e => setDraft({ ...draft, hours: e.target.value })} /></div>
            </div>
            <div><label className="text-xs text-gray-600">件名</label><input className={inp} placeholder="例: 10月第3週の作業報告" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
            <div><label className="text-xs text-gray-600">報告内容</label><textarea className={inp} rows={8} placeholder="実施した業務、成果、課題、次回の予定など" value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setDraft(null)}>閉じる</button><button className={btnPrimary} onClick={save}>{draft.id ? '更新' : '提出'}</button></div>
        </Modal>
      )}
    </div>
  );
}
