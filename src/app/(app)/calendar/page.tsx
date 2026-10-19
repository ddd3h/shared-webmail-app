'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Mailbox = { id: string; display_name: string; type: string; email_address: string };
type CalEvent = {
  id: string; source: string; title: string; renamed: boolean; original_title: string | null;
  description: string | null; location: string | null; all_day: boolean;
  start_at: string; end_at: string; color: string | null; link_name: string | null; created_by: string | null;
};
type Link = {
  id: string; name: string; color: string; display_mode: 'busy_only' | 'full'; busy_label: string;
  google_calendar_id: string | null; last_synced_at: string | null; last_error: string | null;
  linked_by: { name: string };
};
type Draft = {
  id?: string; source?: string; title: string; description: string; location: string;
  all_day: boolean; start: string; end: string; original_title?: string | null; renamed?: boolean; readOnlyDetails?: boolean;
};

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const LOCAL_COLOR = '#2563eb';

// All-day events from Google are stored as UTC-midnight dates; show them as local dates.
function evStart(e: CalEvent) { const d = new Date(e.start_at); return e.all_day ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d; }
function evEndExclusive(e: CalEvent) { const d = new Date(e.end_at); return e.all_day ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d; }

function occursOn(e: CalEvent, day: Date) {
  const s = evStart(e);
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = evEndExclusive(e);
  return s < next && (end > dayStart || (end.getTime() === s.getTime() && s >= dayStart));
}

function timeLabel(e: CalEvent) {
  if (e.all_day) return '終日';
  return `${hm(new Date(e.start_at))}–${hm(new Date(e.end_at))}`;
}

export default function CalendarPage() {
  return <Suspense fallback={null}><CalendarView /></Suspense>;
}

function CalendarView() {
  const sp = useSearchParams();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [mailboxId, setMailboxId] = useState(sp.get('mailbox') || '');
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(() => new Date());
  // "Today" differs between server (UTC) and browser, so only render dates after mount.
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [perm, setPerm] = useState({ can_edit: false, can_manage: false });
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showSettings, setShowSettings] = useState(!!sp.get('link'));
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function flash(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  }

  useEffect(() => {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    setSelected(n);
    setReady(true);
    const err = sp.get('google_error');
    if (err) flash('error', `Google連携に失敗しました (${err})`);
    fetch('/api/mailboxes?mine=1').then(r => r.json()).then(d => {
      const items: Mailbox[] = (d.items || []).filter((m: any) => m.is_active && m.user_permissions?.can_view);
      setMailboxes(items);
      setMailboxId(cur => cur || items.find(m => m.type === 'team')?.id || items[0]?.id || '');
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Grid always starts on Sunday and covers 6 weeks.
  const gridStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1 - cursor.getDay()), [cursor]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)), [gridStart]);

  const load = useCallback(async () => {
    if (!mailboxId || !ready) return;
    setLoading(true);
    try {
      const from = new Date(gridStart.getTime() - 86400_000).toISOString();
      const to = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 43).toISOString();
      const res = await fetch(`/api/calendar/events?mailboxId=${mailboxId}&from=${from}&to=${to}`);
      if (res.ok) {
        const d = await res.json();
        setEvents(d.items); setLinks(d.links); setPerm(d.permissions); setGoogleConfigured(d.google_configured);
      }
    } finally { setLoading(false); }
  }, [mailboxId, gridStart, ready]);

  useEffect(() => { load(); }, [load]);

  const dayEvents = (d: Date) => events.filter(e => occursOn(e, d));
  const selectedEvents = dayEvents(selected);
  const today = ymd(new Date());

  function newDraft(day: Date): Draft {
    const d = ymd(day);
    return { title: '', description: '', location: '', all_day: false, start: `${d}T09:00`, end: `${d}T10:00` };
  }

  function openEvent(e: CalEvent) {
    const s = new Date(e.start_at), en = new Date(e.end_at);
    // All-day events are stored as UTC-midnight dates with an exclusive end.
    const utcDay = (x: Date, back = 0) => ymd(new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - back));
    const fmt = (x: Date) => `${ymd(x)}T${hm(x)}`;
    const start = e.all_day ? utcDay(s) : fmt(s);
    const endShown = e.all_day ? utcDay(en, en > s ? 1 : 0) : fmt(en);
    setDraft({
      id: e.id, source: e.source, title: e.source === 'google' ? (e.renamed ? e.title : '') : e.title,
      description: e.description || '', location: e.location || '', all_day: e.all_day,
      start, end: endShown, original_title: e.original_title, renamed: e.renamed,
      readOnlyDetails: e.source === 'google',
    });
  }

  async function save() {
    if (!draft) return;
    const isGoogle = draft.source === 'google';
    let res: Response;
    if (isGoogle) {
      res = await fetch(`/api/calendar/events/${draft.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title_override: draft.title.trim() || null }),
      });
    } else {
      const start = draft.all_day ? new Date(`${draft.start.slice(0, 10)}T00:00:00Z`) : new Date(draft.start);
      const end = draft.all_day ? new Date(new Date(`${draft.end.slice(0, 10)}T00:00:00Z`).getTime() + 86400_000) : new Date(draft.end);
      const body = {
        mailboxId, title: draft.title, description: draft.description, location: draft.location,
        all_day: draft.all_day, start_at: start.toISOString(), end_at: end.toISOString(),
      };
      res = draft.id
        ? await fetch(`/api/calendar/events/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/calendar/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (res.ok) { setDraft(null); flash('success', '保存しました'); load(); }
    else flash('error', '保存に失敗しました。入力内容を確認してください');
  }

  async function remove() {
    if (!draft?.id || !confirm('この予定を削除しますか？')) return;
    const res = await fetch(`/api/calendar/events/${draft.id}`, { method: 'DELETE' });
    if (res.ok) { setDraft(null); load(); } else flash('error', '削除に失敗しました');
  }

  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[10rem]">
          <h1 className="text-xl font-bold text-gray-900">カレンダー</h1>
          <p className="text-xs text-gray-500 mt-0.5">共有メールアカウントごとのチームカレンダー</p>
        </div>
        <select value={mailboxId} onChange={e => setMailboxId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
          {mailboxes.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        {perm.can_manage && (
          <button onClick={() => setShowSettings(true)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Google連携</button>
        )}
        {perm.can_edit && (
          <button onClick={() => setDraft(newDraft(selected))} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">＋ 予定</button>
        )}
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</div>}
      {!mailboxId && !loading && <p className="text-sm text-gray-500">閲覧できるメールアカウントがありません。</p>}

      {ready && <>
      <div className="flex items-center gap-2">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" aria-label="前の月">‹</button>
        <div className="text-base font-semibold text-gray-900 min-w-[7rem] text-center">{cursor.getFullYear()}年{cursor.getMonth() + 1}月</div>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" aria-label="次の月">›</button>
        <button onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); setSelected(n); }} className="ml-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm">今日</button>
        {loading && <span className="text-xs text-gray-400">読み込み中…</span>}
      </div>

      <div className="grid md:grid-cols-[1fr_20rem] gap-4">
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="grid grid-cols-7 bg-gray-50 text-center text-xs text-gray-500">
            {WEEK.map((w, i) => <div key={w} className={`py-1.5 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}`}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map(d => {
              const list = dayEvents(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isSel = ymd(d) === ymd(selected);
              return (
                <button key={d.toISOString()} onClick={() => setSelected(d)}
                  className={`flex flex-col items-stretch justify-start min-h-[4.5rem] md:min-h-[6rem] border-t border-l border-gray-100 p-1 text-left align-top ${inMonth ? 'bg-white' : 'bg-gray-50/70'} ${isSel ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                  <div className={`text-xs mb-0.5 ${ymd(d) === today ? 'flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'}`}>{d.getDate()}</div>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map(e => (
                      <div key={e.id} className="truncate rounded px-1 text-[10px] md:text-[11px] leading-4 text-white" style={{ background: e.color || LOCAL_COLOR }}>{e.title}</div>
                    ))}
                    {list.length > 3 && <div className="text-[10px] text-gray-500">+{list.length - 3}件</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-gray-200 bg-white p-3 h-fit">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-900">{selected.getMonth() + 1}月{selected.getDate()}日（{WEEK[selected.getDay()]}）</h2>
            {perm.can_edit && <button onClick={() => setDraft(newDraft(selected))} className="text-xs text-blue-600 hover:underline">追加</button>}
          </div>
          {selectedEvents.length === 0 && <p className="text-xs text-gray-400">予定はありません</p>}
          <ul className="space-y-2">
            {selectedEvents.map(e => (
              <li key={e.id}>
                <button onClick={() => openEvent(e)} className="w-full text-left rounded-lg border border-gray-100 p-2 hover:bg-gray-50" style={{ borderLeft: `4px solid ${e.color || LOCAL_COLOR}` }}>
                  <div className="text-xs text-gray-500">{timeLabel(e)}{e.link_name ? ` ・ ${e.link_name}` : ''}</div>
                  <div className="text-sm font-medium text-gray-900 break-words">{e.title}{e.renamed && <span className="ml-1 text-[10px] text-gray-400">(名称変更済)</span>}</div>
                  {e.location && <div className="text-xs text-gray-500 break-words">📍 {e.location}</div>}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      </>}

      {draft && (
        <Modal onClose={() => setDraft(null)} title={draft.source === 'google' ? 'Googleから取り込んだ予定' : draft.id ? '予定を編集' : '予定を追加'}>
          {draft.source === 'google' ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Googleの予定は読み取り専用です。このアプリ内での表示名だけ変更できます。</p>
              <div>
                <label className="text-xs text-gray-600">表示名（空欄で元の表示に戻す）</label>
                <input className={inp} value={draft.title} disabled={!perm.can_edit} placeholder={draft.original_title || '予定あり'} onChange={e => setDraft({ ...draft, title: e.target.value })} />
              </div>
              {draft.original_title && <p className="text-xs text-gray-500">元のタイトル: {draft.original_title}</p>}
              {draft.location && <p className="text-xs text-gray-500">場所: {draft.location}</p>}
              {draft.description && <p className="text-xs text-gray-500 whitespace-pre-wrap break-words">{draft.description}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <input className={inp} placeholder="タイトル" value={draft.title} disabled={!perm.can_edit} onChange={e => setDraft({ ...draft, title: e.target.value })} />
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={draft.all_day} disabled={!perm.can_edit} onChange={e => setDraft({ ...draft, all_day: e.target.checked, start: draft.start.slice(0, 10) + (e.target.checked ? '' : 'T09:00'), end: draft.end.slice(0, 10) + (e.target.checked ? '' : 'T10:00') })} />終日
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-600">開始</label><input className={inp} type={draft.all_day ? 'date' : 'datetime-local'} value={draft.start} disabled={!perm.can_edit} onChange={e => setDraft({ ...draft, start: e.target.value, end: e.target.value > draft.end ? e.target.value : draft.end })} /></div>
                <div><label className="text-xs text-gray-600">終了</label><input className={inp} type={draft.all_day ? 'date' : 'datetime-local'} value={draft.end} min={draft.start} disabled={!perm.can_edit} onChange={e => setDraft({ ...draft, end: e.target.value })} /></div>
              </div>
              <input className={inp} placeholder="場所" value={draft.location} disabled={!perm.can_edit} onChange={e => setDraft({ ...draft, location: e.target.value })} />
              <textarea className={inp} rows={3} placeholder="メモ" value={draft.description} disabled={!perm.can_edit} onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </div>
          )}
          <div className="flex items-center gap-2 pt-4">
            {perm.can_edit && draft.id && draft.source !== 'google' && <button onClick={remove} className="text-sm text-red-600 hover:underline">削除</button>}
            <div className="flex-1" />
            <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">閉じる</button>
            {perm.can_edit && <button onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">保存</button>}
          </div>
        </Modal>
      )}

      {showSettings && (
        <GoogleSettings mailboxId={mailboxId} links={links} configured={googleConfigured} focusLink={sp.get('link')}
          onClose={() => setShowSettings(false)} onChanged={load} flash={flash} />
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose}>
      <div className="w-full md:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-white p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function GoogleSettings({ mailboxId, links, configured, focusLink, onClose, onChanged, flash }: {
  mailboxId: string; links: Link[]; configured: boolean; focusLink: string | null;
  onClose: () => void; onChanged: () => void; flash: (t: 'success' | 'error', s: string) => void;
}) {
  const [options, setOptions] = useState<Record<string, { id: string; name: string; primary: boolean }[]>>({});
  const inp = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm w-full';

  useEffect(() => {
    links.filter(l => !l.google_calendar_id && !options[l.id]).forEach(async l => {
      const res = await fetch(`/api/calendar/links/${l.id}/calendars`);
      if (res.ok) { const d = await res.json(); setOptions(o => ({ ...o, [l.id]: d.items })); }
    });
  }, [links]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(id: string, body: object) {
    const res = await fetch(`/api/calendar/links/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { flash('success', '更新しました'); onChanged(); } else flash('error', '更新に失敗しました');
  }
  async function unlink(id: string) {
    if (!confirm('連携を解除しますか？取り込んだ予定もこのカレンダーから消えます。')) return;
    const res = await fetch(`/api/calendar/links/${id}`, { method: 'DELETE' });
    if (res.ok) onChanged(); else flash('error', '解除に失敗しました');
  }
  async function sync(id: string) {
    const res = await fetch(`/api/calendar/links/${id}/sync`, { method: 'POST' });
    if (res.ok) { flash('success', '同期しました'); } else flash('error', '同期に失敗しました');
    onChanged();
  }

  return (
    <Modal title="Googleカレンダー連携" onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">Googleの予定をこのカレンダーに取り込みます（読み取り専用）。「予定あり」のみ表示にすると、タイトルや詳細は保存も表示もされません。</p>
      <div className="space-y-4">
        {links.map(l => (
          <div key={l.id} className={`rounded-lg border p-3 space-y-2 ${l.id === focusLink ? 'border-blue-400' : 'border-gray-200'}`}>
            {!l.google_calendar_id ? (
              <div>
                <label className="text-xs text-gray-600">取り込むGoogleカレンダーを選択</label>
                <select className={inp} defaultValue="" onChange={e => e.target.value && patch(l.id, { google_calendar_id: e.target.value, name: options[l.id]?.find(o => o.id === e.target.value)?.name })}>
                  <option value="" disabled>選択してください</option>
                  {(options[l.id] || []).map(o => <option key={o.id} value={o.id}>{o.name}{o.primary ? '（メイン）' : ''}</option>)}
                </select>
                <button onClick={() => unlink(l.id)} className="mt-2 text-xs text-red-600 hover:underline">キャンセル</button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input className={inp} defaultValue={l.name} onBlur={e => e.target.value !== l.name && patch(l.id, { name: e.target.value })} aria-label="表示名" />
                  <input type="color" defaultValue={l.color} onBlur={e => e.target.value !== l.color && patch(l.id, { color: e.target.value })} className="h-9 w-12 rounded border border-gray-300" aria-label="色" />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1"><input type="radio" checked={l.display_mode === 'busy_only'} onChange={() => patch(l.id, { display_mode: 'busy_only' })} />予定ありのみ</label>
                  <label className="flex items-center gap-1"><input type="radio" checked={l.display_mode === 'full'} onChange={() => patch(l.id, { display_mode: 'full' })} />詳細も表示</label>
                </div>
                {l.display_mode === 'busy_only' && (
                  <div><label className="text-xs text-gray-600">表示ラベル</label>
                    <input className={inp} defaultValue={l.busy_label} onBlur={e => e.target.value.trim() && e.target.value !== l.busy_label && patch(l.id, { busy_label: e.target.value })} /></div>
                )}
                <div className="text-xs text-gray-500">連携者: {l.linked_by.name} ・ 最終同期: {l.last_synced_at ? new Date(l.last_synced_at).toLocaleString('ja-JP') : '未同期'}</div>
                {l.last_error && <div className="text-xs text-red-600 break-words">エラー: {l.last_error}</div>}
                <div className="flex gap-3 text-xs">
                  <button onClick={() => sync(l.id)} className="text-blue-600 hover:underline">今すぐ同期</button>
                  <button onClick={() => unlink(l.id)} className="text-red-600 hover:underline">連携解除</button>
                </div>
              </>
            )}
          </div>
        ))}
        {configured ? (
          <a href={`/api/calendar/google/auth?mailboxId=${mailboxId}`} className="inline-block rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">＋ Googleカレンダーを連携</a>
        ) : (
          <p className="text-xs text-amber-600">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定のため、Google連携は利用できません。</p>
        )}
      </div>
      <div className="flex justify-end pt-4"><button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">閉じる</button></div>
    </Modal>
  );
}
