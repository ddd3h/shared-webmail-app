'use client';
import { useCallback, useEffect, useState } from 'react';
import { shortDate, type Plan } from '@/lib/pay-schedule';
import { MonthNav, Modal, Notice, Stat, btn, btnPrimary, currentMonth, dateLabel, inp, api, PanelSkeleton } from './ui';

type Report = { id: string; report_date: string; title: string; content: string; hours: number | null; activity_flag?: boolean; activity_note?: string | null; user?: { id: string; name: string }; pay_plan: Plan };
// 準業務委託: ログインの記録がない日の報告をしようとしたときの警告
type Warning = { days: number; last_login: string | null; report_date: string };
type Sched = { summary: string; today: string; period: { month: string; closing_date: string; report_deadline: string; pay_date: string } };
type Draft = { id?: string; report_date: string; title: string; content: string; hours: string };

// `monthly`: 準業務委託 hands in one report a month (it can be edited and added to during the month).
// Contractors submit their 業務報告書 here. In `admin` mode it lists everyone's reports (read-only, deletable).
export default function ReportsPanel({ admin = false, userId, monthly = false }: { admin?: boolean; userId?: string; monthly?: boolean }) {
  const [month, setMonth] = useState('');
  const [items, setItems] = useState<Report[]>([]);
  const [loaded, setLoaded] = useState(false);   // the first answer has arrived (until then: a placeholder, not "nothing here")
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sched, setSched] = useState<Sched | null>(null);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [mergePlan, setMergePlan] = useState<{ user_name: string; period: string; count: number }[] | null>(null); // admin: reports to put together

  useEffect(() => { setMonth(currentMonth()); }, []);
  // my own 締め日・提出期限 (a contractor's view; the administrators' list is of everyone, each with their own)
  useEffect(() => { if (!admin) fetch('/api/work/schedule').then(r => r.ok ? r.json() : null).then(setSched).catch(() => {}); }, [admin]);
  const load = useCallback(async () => {
    if (!month) return;
    const q = new URLSearchParams({ month, ...(userId ? { userId } : {}) });
    const res = await fetch(`/api/work/reports?${q}`);
    if (res.ok) { const d = await res.json(); setItems(d.items); setTotal(d.total_hours); }
    setLoaded(true);
  }, [month, userId]);
  useEffect(() => { load(); }, [load]);

  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }
  const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  // `ack`: 「ログインの記録がない」という警告を読んで、それでも提出する、と本人が選んだ
  async function save(ack = false) {
    if (!draft) return;
    const body = { report_date: draft.report_date, title: draft.title, content: draft.content, hours: draft.hours === '' ? null : Number(draft.hours), ...(ack ? { activity_ack: true } : {}) };
    const res = draft.id ? await api(`/api/work/reports/${draft.id}`, 'PATCH', body) : await api('/api/work/reports', 'POST', body);
    if (res.ok) { setWarning(null); setDraft(null); flash('success', '報告書を提出しました'); load(); return; }
    const d = await res.json().catch(() => ({}));
    if (res.status === 409 && d.error === 'period_already_reported') { // one report a period: go to the one already handed in
      setWarning(null); setDraft(null); setMonth(String(d.report_date).slice(0, 7)); setOpen(d.id);
      flash('error', 'この月の報告書は、もう提出されています。その報告書の「編集」から、内容を追記してください');
      return;
    }
    if (res.status === 409 && d.error === 'activity_warning') { setWarning({ days: d.days, last_login: d.last_login, report_date: draft.report_date }); return; }
    setWarning(null);
    flash('error', '保存に失敗しました。件名と内容を入力してください');
  }
  // admin: reports a 準業務委託 person had already handed in several times in one month become one (a list first, nothing changes until confirmed)
  async function planMerge() {
    const res = await api('/api/work/reports/merge', 'POST', {});
    if (!res.ok) return flash('error', '確認できませんでした');
    const d = await res.json();
    if (d.items.length === 0) return flash('success', '1か月に2通以上出している人はいません');
    setMergePlan(d.items);
  }
  async function applyMerge() {
    const res = await api('/api/work/reports/merge', 'POST', { apply: true });
    setMergePlan(null);
    if (res.ok) { flash('success', `${(await res.json()).items.length}件を、1通にまとめました`); load(); } else flash('error', 'まとめられませんでした');
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
        {admin && <button className={btn} onClick={planMerge} data-testid="merge-reports">準業務委託の報告書をまとめる…</button>}
        {!admin && <button className={btnPrimary} onClick={() => setDraft({ report_date: today(), title: '', content: '', hours: '' })}>＋ 報告書を作成</button>}
      </div>
      <Notice msg={msg} />
      {sched && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="report-schedule">
          {Number(sched.period.month.slice(5))}月分: 締め日 {shortDate(sched.period.closing_date)}・提出期限 {shortDate(sched.period.report_deadline)}・支払 {shortDate(sched.period.pay_date)}（{sched.summary}）。期限を過ぎて提出した報告書は、次の期間の分として扱われます。
        </p>
      )}
      {monthly && !admin && <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900" data-testid="monthly-note">準業務委託の業務報告書は、<b>月に1通</b>の提出で十分です。提出したあとも、その月のうちは「編集」で内容を追記できます。</p>}
      {!loaded ? <PanelSkeleton cols={2} /> : (
        <div className="tab-fade grid grid-cols-2 gap-3 max-w-md">
          <Stat label="提出件数" value={`${items.length}件`} />
          <Stat label="報告した稼働時間" value={`${total}h`} />
        </div>
      )}
      <div className={`space-y-2 ${loaded ? 'tab-fade' : ''}`}>
        {loaded && items.length === 0 && <p className="text-sm text-gray-400">この月の報告書はありません</p>}
        {items.map(r => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <button className="w-full text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{dateLabel(r.report_date)}</span>{admin && r.user && <span className="rounded-sm bg-gray-100 px-1.5 py-0.5">{r.user.name}</span>}
                {r.hours !== null && <span>{r.hours}h</span>}
                {r.activity_flag && <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700" title={r.activity_note ?? undefined} data-testid="activity-flag">⚠ ログインの記録なし</span>}
                {r.pay_plan.late
                  ? <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">期限後の提出 → {Number(r.pay_plan.period.slice(5))}月分（支払 {shortDate(r.pay_plan.pay_date)}）</span>
                  : <span className="text-[11px] text-gray-400">支払 {shortDate(r.pay_plan.pay_date)}</span>}
              </div>
              <div className="text-sm font-medium text-gray-900 mt-0.5">{r.title}</div>
            </button>
            {open === r.id && (
              <div className="mt-2 border-t border-gray-100 pt-2">
                {r.activity_flag && <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">⚠ {r.activity_note || 'ログインの記録がない期間の報告です。'}</p>}
                <p className="whitespace-pre-wrap wrap-break-word text-sm text-gray-700">{r.content}</p>
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
            <div><label className="text-xs text-gray-600">件名</label><input className={inp} placeholder={monthly ? '例: 10月分 業務報告' : '例: 10月第3週の作業報告'} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
            <div><label className="text-xs text-gray-600">報告内容</label><textarea className={inp} rows={8} placeholder="実施した業務、成果、課題、次回の予定など" value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setDraft(null)}>閉じる</button><button className={btnPrimary} onClick={() => save()}>{draft.id ? '更新' : '提出'}</button></div>
        </Modal>
      )}
      {mergePlan && (
        <Modal title="1か月に複数出している報告書を、1通にまとめます" onClose={() => setMergePlan(null)}>
          <div className="space-y-2 text-sm text-gray-800" data-testid="merge-plan">
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {mergePlan.map((p, i) => <li key={i} className="flex justify-between px-3 py-2"><span>{p.user_name} ・ {Number(p.period.slice(5))}月分</span><span className="text-gray-600">{p.count}通 → 1通</span></li>)}
            </ul>
            <p className="text-xs text-gray-500">いちばん古い提出を残し、ほかの報告の内容は、日付と件名をつけて1通にまとめます（内容は消えません）。稼働時間は合計し、「ログインの記録なし」の印も残します。</p>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setMergePlan(null)}>やめる</button><button className={btnPrimary} onClick={applyMerge}>まとめる</button></div>
        </Modal>
      )}
      {draft && warning && (
        <Modal title="⚠ 虚偽の報告になっていないか、確認してください" onClose={() => setWarning(null)}>
          <div className="space-y-3 text-sm text-gray-800" data-testid="activity-warning">
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-800">
              {warning.report_date} までの{warning.days}日間、あなたのログインの記録がありません
              {warning.last_login ? `（最後のログイン: ${warning.last_login}）` : '（ログインの記録そのものがありません）'}。
            </p>
            <p>実際には業務を行っていないのに、行ったと報告することは<b>虚偽の報告</b>です。契約違反にあたり、報酬の返還や契約の解除を求められることがあります。内容によっては、詐欺などの<b>犯罪</b>として責任を問われる場合もあります。</p>
            <p>この報告書は、「ログインの記録がない期間の報告」として、<b>警告つきで経理担当と管理者に届きます</b>。</p>
            <p className="text-xs text-gray-500">オフラインで作業をしていた場合など、事実に間違いがなければ、そのまま提出できます。</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-4">
            <button className={btnPrimary} onClick={() => setWarning(null)}>提出しない</button>
            <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50" onClick={() => save(true)}>問題ありません。提出する</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
