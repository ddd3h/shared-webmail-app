'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Modal from '@/components/Modal';
import ChoiceList from '@/components/mobile/ChoiceList';
import Fab from '@/components/mobile/Fab';
import TimeGrid, { type GridEvent, type GridTodo } from '@/components/calendar/TimeGrid';
import TodoModal from '@/components/todos/TodoModal';
import { VIEWS, addDays, isView, parseYmd, shiftAnchor, viewTitle, visibleDays, type CalendarView } from '@/lib/calendar-view';
import { setDone, type Todo } from '@/components/todos/types';

type Mailbox = { id: string; display_name: string; type: string; email_address: string };
type CalEvent = {
  id: string; source: string; title: string; renamed: boolean; original_title: string | null;
  description: string | null; location: string | null; all_day: boolean;
  start_at: string; end_at: string; color: string | null; link_name: string | null; created_by: string | null;
  owner: { id: string; name: string }; attendees: { id: string; name: string }[]; can_edit: boolean;
};
type Person = { id: string; name: string };
type Link = {
  id: string; name: string; color: string; display_mode: 'busy_only' | 'full'; busy_label: string;
  google_calendar_id: string | null; last_synced_at: string | null; last_error: string | null;
  linked_by_user_id: string; linked_by: { name: string };
};
type Draft = {
  id?: string; source?: string; owner?: { id: string; name: string }; attendees: string[]; canEdit: boolean; title: string; description: string; location: string;
  all_day: boolean; start: string; end: string; original_title?: string | null; renamed?: boolean; readOnlyDetails?: boolean;
};

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const PALETTE = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#0891b2', '#84cc16', '#f97316', '#6366f1'];

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
  // '' = my own calendar; a shared mailbox shows the calendars of its members
  const [mailboxId, setMailboxId] = useState(sp.get('mailbox') || '');
  // which of the three views is open (day / week / month); remembered for next time unless the address says otherwise
  const [view, setView] = useState<CalendarView>(() => (isView(sp.get('view')) ? (sp.get('view') as CalendarView) : 'month'));
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(() => new Date());
  // "Today" differs between server (UTC) and browser, so only render dates after mount.
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [people, setPeople] = useState<Person[]>([]);          // whose calendars are on screen
  const [everybody, setEverybody] = useState<Person[]>([]);     // everybody who can be invited
  const [assignable, setAssignable] = useState<Person[]>([]);   // whose list a to-do may be put on
  const [me, setMe] = useState('');
  // ids of people whose schedules are shown; null = everyone
  const [shown, setShown] = useState<Set<string> | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  // to-dos with a due date are drawn on the calendar too
  const [todos, setTodos] = useState<Todo[]>([]);
  const [showTodos, setShowTodos] = useState(true);
  const [todoModal, setTodoModal] = useState<{ todo?: Todo; due?: string } | null>(null);
  const [showSettings, setShowSettings] = useState(!!sp.get('link'));
  // phone only: what is open in a sheet (the mailbox list, the display settings, or the "add" choices)
  const [sheet, setSheet] = useState<'mailbox' | 'display' | 'add' | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function flash(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  }

  useEffect(() => {
    const dateParam = sp.get('date');
    const n = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? parseYmd(dateParam) : new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    setSelected(n);
    if (!isView(sp.get('view'))) { try { const saved = localStorage.getItem('calendar-view'); if (isView(saved)) setView(saved); } catch { /* private mode etc. */ } }
    setReady(true);
    const err = sp.get('google_error');
    if (err) flash('error', `Google連携に失敗しました (${err})`);
    fetch('/api/mailboxes?mine=1').then(r => r.json()).then(d => {
      setMailboxes((d.items || []).filter((m: any) => m.is_active && m.user_permissions?.can_view && m.type === 'team'));
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The days on screen: the 6-week grid of the month, the 7 days of the week, or the one day.
  const anchor = view === 'month' ? cursor : selected;
  const days = useMemo(() => visibleDays(view, anchor), [view, ymd(anchor)]); // eslint-disable-line react-hooks/exhaustive-deps
  const gridStart = days[0];

  // The address says which view and day are open, so a view can be shared or reloaded as it is
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(window.location.search);
    q.set('view', view); q.set('date', ymd(selected));
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
    try { localStorage.setItem('calendar-view', view); } catch { /* private mode etc. */ }
  }, [ready, view, selected]);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const lastDay = days[days.length - 1];
      const from = addDays(gridStart, -1).toISOString();
      const to = addDays(lastDay, 2).toISOString();
      const q = mailboxId ? `mailboxId=${mailboxId}&` : '';
      const [res, todoRes] = await Promise.all([
        fetch(`/api/calendar/events?${q}from=${from}&to=${to}`),
        fetch(`/api/todos?${q}from=${ymd(gridStart)}&to=${ymd(lastDay)}`),
      ]);
      if (res.ok) {
        const d = await res.json();
        setEvents(d.items); setLinks(d.links); setPeople(d.people); setEverybody(d.everybody); setMe(d.me); setGoogleConfigured(d.google_configured);
      }
      if (todoRes.ok) { const d = await todoRes.json(); setTodos(d.items); setAssignable(d.assignable); }
    } finally { setLoading(false); }
  }, [mailboxId, gridStart, days, ready]);

  useEffect(() => { load(); }, [load]);

  // a person keeps one colour wherever they appear (the order of the company's list)
  const colorOf = useCallback((id: string | null) => PALETTE[Math.max(0, everybody.findIndex(p => p.id === id)) % PALETTE.length], [everybody]);
  // an event is shown when its owner or anybody who takes part is one of the people chosen
  const isShown = (e: CalEvent) => !shown || shown.has(e.owner.id) || e.attendees.some(a => shown.has(a.id));
  const dayEvents = (d: Date) => events.filter(e => isShown(e) && occursOn(e, d));
  function toggle(id: string) {
    const next = new Set(shown ?? people.map(p => p.id));
    next.has(id) ? next.delete(id) : next.add(id);
    setShown(next);
  }
  const todosOn = (d: Date) => showTodos ? todos.filter(t => t.due_date === ymd(d) && (!shown || shown.has(t.assignee.id))) : [];
  const selectedEvents = dayEvents(selected);
  const selectedTodos = todosOn(selected);
  const filtered = !!shown && shown.size < people.length; // somebody is hidden
  const unit = { day: '日', week: '週', month: '月' }[view];
  const todayDate = () => new Date();
  function step(dir: -1 | 1) {
    if (view === 'month') { setCursor(shiftAnchor('month', cursor, dir)); return; }
    const next = shiftAnchor(view, selected, dir);
    setSelected(next); setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
  }
  function goToday() { const n = todayDate(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); setSelected(n); }
  function changeView(next: CalendarView) {
    if (next === view) return;
    // from the month grid into a week or a day: stay on the chosen day if it is in that month, otherwise open the 1st
    if (view === 'month' && (selected.getFullYear() !== cursor.getFullYear() || selected.getMonth() !== cursor.getMonth())) setSelected(cursor);
    if (next === 'month') setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setView(next);
  }
  function openDay(d: Date) { setSelected(d); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setView('day'); }
  const todayYmd = ymd(new Date());
  const viewLabel = mailboxId ? `${mailboxes.find(m => m.id === mailboxId)?.display_name ?? ''} のメンバー` : '自分のカレンダー';

  // what the hour-by-hour views draw
  const gridEvents: GridEvent[] = events.filter(isShown).map(e => ({
    id: e.id, allDay: e.all_day, start: e.all_day ? evStart(e) : new Date(e.start_at), end: e.all_day ? evEndExclusive(e) : new Date(e.end_at),
    title: e.title, sub: [e.owner.name, e.attendees.length > 0 ? `ほか${e.attendees.length}人` : '', e.location].filter(Boolean).join(' ・ '), color: colorOf(e.owner.id), open: () => openEvent(e),
  }));
  const gridTodos = (d: Date): GridTodo[] => todosOn(d).map(t => ({ id: t.id, title: t.title, done: t.done, overdue: t.overdue, open: () => setTodoModal({ todo: t }) }));

  async function tick(t: Todo) { if (await setDone(t.id, !t.done)) load(); else flash('error', '更新できませんでした'); }
  const today = ymd(new Date());

  function newDraft(day: Date): Draft {
    const d = ymd(day);
    return { attendees: [], canEdit: true, title: '', description: '', location: '', all_day: false, start: `${d}T09:00`, end: `${d}T10:00` };
  }

  // a click on an empty hour of a day column: a new event that starts there and lasts an hour
  function newDraftAt(day: Date, minutes: number): Draft {
    const at = (m: number) => `${ymd(day)}T${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
    return { ...newDraft(day), start: at(minutes), end: minutes + 60 >= 1440 ? `${ymd(day)}T23:59` : at(minutes + 60) };
  }

  function openEvent(e: CalEvent) {
    const s = new Date(e.start_at), en = new Date(e.end_at);
    // All-day events are stored as UTC-midnight dates with an exclusive end.
    const utcDay = (x: Date, back = 0) => ymd(new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - back));
    const fmt = (x: Date) => `${ymd(x)}T${hm(x)}`;
    const start = e.all_day ? utcDay(s) : fmt(s);
    const endShown = e.all_day ? utcDay(en, en > s ? 1 : 0) : fmt(en);
    setDraft({
      id: e.id, source: e.source, owner: e.owner, attendees: e.attendees.map(a => a.id), canEdit: e.can_edit, title: e.source === 'google' ? (e.renamed ? e.title : '') : e.title,
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
        title: draft.title, description: draft.description, location: draft.location, attendee_ids: draft.attendees,
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

  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">カレンダー</h1>
          <p className="hidden md:block text-xs text-gray-500 mt-0.5">自分のカレンダーです。共有メールを選ぶと、そのメンバーの予定が見られます</p>
          {/* phone: whose calendar, tap to pick another */}
          {mailboxes.length > 0
            ? <button onClick={() => setSheet('mailbox')} className="md:hidden mt-0.5 flex max-w-full items-center gap-1 text-xs text-gray-500"><span className="truncate">{viewLabel}</span><span aria-hidden>▾</span></button>
            : <p className="md:hidden mt-0.5 truncate text-xs text-gray-500">自分のカレンダー</p>}
        </div>
        {mailboxes.length > 0 && (
          <select aria-label="見るカレンダー" value={mailboxId} onChange={e => { setMailboxId(e.target.value); setShown(null); }} className="hidden md:block rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
            <option value="">自分のカレンダー</option>
            {mailboxes.map(m => <option key={m.id} value={m.id}>{m.display_name} のメンバー</option>)}
          </select>
        )}
        {(
          <button onClick={() => setShowSettings(true)} className="hidden md:block rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Google連携</button>
        )}
        {(
          <button onClick={() => setDraft(newDraft(selected))} className="hidden md:block rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">＋ 予定</button>
        )}
        {(
          <button onClick={() => setTodoModal({ due: ymd(selected) })} className="hidden md:block rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">＋ ToDo</button>
        )}
        {/* phone: everything about what is shown lives behind this one button */}
        <button onClick={() => setSheet('display')} aria-label="表示の設定" className="md:hidden relative flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h10m4 0h2M4 12h2m4 0h10M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4" /></svg>
          {(filtered || !showTodos) && <span aria-label="絞り込み中" className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-blue-600" />}
        </button>
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</div>}

      {ready && mailboxId && people.length > 0 && (
        <div className="hidden md:flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">表示する人:</span>
          {people.map(p => {
            const on = !shown || shown.has(p.id);
            const c = colorOf(p.id);
            return (
              <button key={p.id} onClick={() => toggle(p.id)} aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${on ? 'border-gray-300 bg-white text-gray-800' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? c : '#d1d5db' }} />
                {p.name}{p.id === me ? '（自分）' : ''}
              </button>
            );
          })}
          <button onClick={() => setShown(new Set(people.map(p => p.id)))} className="text-xs text-blue-600 hover:underline">全員</button>
          <button onClick={() => setShown(new Set([me]))} className="text-xs text-blue-600 hover:underline">自分のみ</button>
        </div>
      )}

      {ready && <>
      {/* On a phone the arrows and the heading take a row of their own (order), on a wide screen everything is in one line */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="表示の切り替え" className="order-1 flex overflow-hidden rounded-lg border border-gray-300 text-sm sm:order-none">
          {VIEWS.map(v => (
            <button key={v.key} onClick={() => changeView(v.key)} aria-pressed={view === v.key}
              className={`px-3 py-1.5 ${view === v.key ? 'bg-gray-900 font-medium text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{v.label}</button>
          ))}
        </div>
        <div className="order-3 flex w-full items-center gap-2 sm:order-none sm:w-auto">
          <button onClick={() => step(-1)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" aria-label={`前の${unit}`}>‹</button>
          <div aria-live="polite" className="min-w-0 flex-1 text-center text-base font-semibold text-gray-900 sm:min-w-28 sm:flex-none">{viewTitle(view, anchor)}</div>
          <button onClick={() => step(1)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" aria-label={`次の${unit}`}>›</button>
        </div>
        <button onClick={goToday} className="order-2 px-3 py-1.5 rounded-lg border border-gray-300 text-sm sm:order-none sm:ml-1">今日</button>
        {loading && <span className="order-4 text-xs text-gray-400 sm:order-none">読み込み中…</span>}
        <label className="hidden md:flex ml-auto items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={showTodos} onChange={e => setShowTodos(e.target.checked)} />ToDoも表示
        </label>
      </div>

      {ready && view !== 'month' && (
        <TimeGrid days={days} events={gridEvents} todosOn={gridTodos} today={todayYmd} canEdit
          onCreate={(day, minutes) => setDraft(newDraftAt(day, minutes))} onPickDay={openDay} />
      )}

      {view === 'month' && <div className="grid md:grid-cols-[1fr_20rem] gap-4">
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="grid grid-cols-7 bg-gray-50 text-center text-xs text-gray-500">
            {WEEK.map((w, i) => <div key={w} className={`py-1.5 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}`}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map(d => {
              const list = dayEvents(d);
              const dayTodos = todosOn(d);
              // three lines a day; a day with to-dos keeps room for at least one of them
              const shownEvents = list.slice(0, dayTodos.length > 0 ? 2 : 3);
              const shownTodos = dayTodos.slice(0, 3 - shownEvents.length);
              const hidden = list.length + dayTodos.length - shownEvents.length - shownTodos.length;
              const inMonth = d.getMonth() === cursor.getMonth();
              const isSel = ymd(d) === ymd(selected);
              return (
                <button key={d.toISOString()} data-date={ymd(d)} onClick={() => setSelected(d)}
                  className={`flex flex-col items-stretch justify-start min-h-12 md:min-h-24 border-t border-l border-gray-100 p-1 text-left align-top ${inMonth ? 'bg-white' : 'bg-gray-50/70'} ${isSel ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                  <div className={`text-xs mb-0.5 ${ymd(d) === today ? 'flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'}`}>{d.getDate()}</div>
                  {/* phone: small dots (one per event, a square for to-dos); the day's list is below the grid */}
                  <div className="md:hidden flex flex-wrap gap-0.5 px-0.5">
                    {list.slice(0, 4).map(e => <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf(e.owner.id) }} />)}
                    {dayTodos.length > 0 && <span className="h-1.5 w-1.5 rounded-xs border border-amber-500" />}
                  </div>
                  <div className="hidden md:block space-y-0.5">
                    {shownEvents.map(e => (
                      <div key={e.id} className="truncate rounded-sm px-1 text-[10px] md:text-[11px] leading-4 text-white" style={{ background: colorOf(e.owner.id) }}>{e.title}</div>
                    ))}
                    {shownTodos.map(t => (
                      <div key={t.id} data-testid="todo-chip" className={`truncate rounded-sm border border-dashed px-1 text-[10px] md:text-[11px] leading-4 ${t.done ? 'border-gray-300 text-gray-400 line-through' : t.overdue ? 'border-red-400 bg-red-50 text-red-700' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>{t.done ? '☑' : '☐'} {t.title}</div>
                    ))}
                    {hidden > 0 && <div className="text-[10px] text-gray-500">+{hidden}件</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-gray-200 bg-white p-3 h-fit">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-900">{selected.getMonth() + 1}月{selected.getDate()}日（{WEEK[selected.getDay()]}）</h2>
            {<button onClick={() => setDraft(newDraft(selected))} className="hidden md:block text-xs text-blue-600 hover:underline">追加</button>}
          </div>
          {selectedEvents.length === 0 && <p className="text-xs text-gray-400">予定はありません</p>}
          <ul className="space-y-2">
            {selectedEvents.map(e => (
              <li key={e.id}>
                <button onClick={() => openEvent(e)} className="w-full text-left rounded-lg border border-gray-100 p-2 hover:bg-gray-50" style={{ borderLeft: `4px solid ${colorOf(e.owner.id)}` }}>
                  <div className="text-xs text-gray-500">{timeLabel(e)} ・ {e.owner.name}{e.attendees.length > 0 ? ` ほか${e.attendees.length}人` : ''}</div>
                  <div className="text-sm font-medium text-gray-900 wrap-break-word">{e.title}{e.renamed && <span className="ml-1 text-[10px] text-gray-400">(名称変更済)</span>}</div>
                  {e.location && <div className="text-xs text-gray-500 wrap-break-word">📍 {e.location}</div>}
                </button>
              </li>
            ))}
          </ul>
          {selectedTodos.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3" aria-label="この日のToDo">
              <h3 className="mb-2 text-xs font-semibold text-gray-700">ToDo</h3>
              <ul className="space-y-1.5">
                {selectedTodos.map(t => (
                  <li key={t.id} className="flex items-start gap-2">
                    <button onClick={() => tick(t)} disabled={!t.can_edit} role="checkbox" aria-checked={t.done} aria-label={`${t.title}を${t.done ? '未完了に戻す' : '完了にする'}`}
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] ${t.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white hover:border-blue-500'} disabled:opacity-40`}>{t.done ? '✓' : ''}</button>
                    <button onClick={() => setTodoModal({ todo: t })} className="min-w-0 flex-1 text-left">
                      <div className={`text-sm wrap-break-word ${t.done ? 'text-gray-400 line-through' : t.overdue ? 'text-red-700' : 'text-gray-900'}`}>{t.title}</div>
                      <div className="text-xs text-gray-500">{t.assignee.name}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>}
      </>}

      {draft && (
        <Modal onClose={() => setDraft(null)} title={draft.source === 'google' ? 'Googleから取り込んだ予定' : draft.id ? (draft.canEdit ? '予定を編集' : '予定') : '予定を追加'}>
          {draft.source === 'google' ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Googleの予定は読み取り専用です。このアプリ内での表示名だけ変更できます。</p>
              <div>
                <label className="text-xs text-gray-600">表示名（空欄で元の表示に戻す）</label>
                <input className={inp} value={draft.title} disabled={!draft.canEdit} placeholder={draft.original_title || '予定あり'} onChange={e => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <p className="text-xs text-gray-500">誰の予定: {draft.owner?.name}</p>
              {draft.original_title && <p className="text-xs text-gray-500">元のタイトル: {draft.original_title}</p>}
              {draft.location && <p className="text-xs text-gray-500">場所: {draft.location}</p>}
              {draft.description && <p className="text-xs text-gray-500 whitespace-pre-wrap wrap-break-word">{draft.description}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <input className={inp} placeholder="タイトル" value={draft.title} disabled={!draft.canEdit} onChange={e => setDraft({ ...draft, title: e.target.value })} />
              {draft.id && draft.owner && <p className="text-xs text-gray-500" data-testid="event-owner">{draft.owner.id === me ? '自分の予定' : `${draft.owner.name} さんの予定（参加者として入っています）`}</p>}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={draft.all_day} disabled={!draft.canEdit} onChange={e => setDraft({ ...draft, all_day: e.target.checked, start: draft.start.slice(0, 10) + (e.target.checked ? '' : 'T09:00'), end: draft.end.slice(0, 10) + (e.target.checked ? '' : 'T10:00') })} />
                終日
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-600" htmlFor="event-start">開始</label><input id="event-start" className={inp} type={draft.all_day ? 'date' : 'datetime-local'} value={draft.start} disabled={!draft.canEdit} onChange={e => setDraft({ ...draft, start: e.target.value, end: draft.end < e.target.value ? e.target.value : draft.end })} /></div>
                <div><label className="text-xs text-gray-600" htmlFor="event-end">終了</label><input id="event-end" className={inp} type={draft.all_day ? 'date' : 'datetime-local'} value={draft.end} min={draft.start} disabled={!draft.canEdit} onChange={e => setDraft({ ...draft, end: e.target.value })} /></div>
              </div>
              <input className={inp} placeholder="場所" value={draft.location} disabled={!draft.canEdit} onChange={e => setDraft({ ...draft, location: e.target.value })} />
              <div data-testid="attendees">
                <label className="text-xs text-gray-600" htmlFor="event-attendee">参加者（それぞれのカレンダーにも入ります）</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {draft.attendees.length === 0 && <span className="text-xs text-gray-400">参加者はいません</span>}
                  {draft.attendees.map(id => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-800">
                      {everybody.find(p => p.id === id)?.name ?? '（不明）'}
                      {draft.canEdit && <button type="button" className="text-blue-400 hover:text-red-600" aria-label={`${everybody.find(p => p.id === id)?.name ?? ''}を参加者から外す`} onClick={() => setDraft({ ...draft, attendees: draft.attendees.filter(x => x !== id) })}>×</button>}
                    </span>
                  ))}
                </div>
                {draft.canEdit && (
                  <select id="event-attendee" className={`${inp} mt-1.5`} value="" onChange={e => e.target.value && setDraft({ ...draft, attendees: [...draft.attendees, e.target.value] })}>
                    <option value="">社内の人を選んで追加…</option>
                    {everybody.filter(p => p.id !== (draft.owner?.id ?? me) && !draft.attendees.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>
              <textarea className={inp} rows={3} placeholder="メモ" value={draft.description} disabled={!draft.canEdit} onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </div>
          )}
          <div className="flex items-center gap-2 pt-4">
            {draft.canEdit && draft.id && draft.source !== 'google' && <button onClick={remove} className="text-sm text-red-600 hover:underline">削除</button>}
            <div className="flex-1" />
            <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">閉じる</button>
            {draft.canEdit && <button onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">保存</button>}
          </div>
        </Modal>
      )}

      <Fab label="追加" onClick={() => setSheet('add')} />

      {sheet === 'mailbox' && (
        <Modal title="見るカレンダー" onClose={() => setSheet(null)}>
          <ChoiceList value={mailboxId} onPick={v => { setMailboxId(v); setShown(null); setSheet(null); }} choices={[{ value: '', label: '自分のカレンダー' }, ...mailboxes.map(m => ({ value: m.id, label: `${m.display_name} のメンバー` }))]} />
        </Modal>
      )}

      {sheet === 'add' && (
        <Modal title="追加する" onClose={() => setSheet(null)}>
          <ChoiceList onPick={v => { setSheet(null); if (v === 'event') setDraft(newDraft(selected)); else setTodoModal({ due: ymd(selected) }); }}
            choices={[{ value: 'event', label: '予定', hint: `${selected.getMonth() + 1}月${selected.getDate()}日に予定を入れる` }, { value: 'todo', label: 'ToDo', hint: `${selected.getMonth() + 1}月${selected.getDate()}日が期限のやること` }]} />
        </Modal>
      )}

      {sheet === 'display' && (
        <Modal title="表示の設定" onClose={() => setSheet(null)}>
          <div className="space-y-5">
            {mailboxId && people.length > 0 && (
              <section aria-label="表示する人">
                <div className="mb-1 flex items-center gap-3">
                  <h4 className="flex-1 text-sm font-semibold text-gray-800">表示する人</h4>
                  <button onClick={() => setShown(new Set(people.map(p => p.id)))} className="text-sm text-blue-600">全員</button>
                  <button onClick={() => setShown(new Set([me]))} className="text-sm text-blue-600">自分のみ</button>
                </div>
                <ul className="-mx-1 divide-y divide-gray-100">
                  {people.map(p => {
                    const on = !shown || shown.has(p.id);
                    return (
                      <li key={p.id}>
                        <button onClick={() => toggle(p.id)} role="checkbox" aria-checked={on} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left active:bg-gray-100">
                          <span className="h-3 w-3 rounded-full" style={{ background: on ? colorOf(p.id) : '#d1d5db' }} />
                          <span className={`flex-1 text-base ${on ? 'text-gray-900' : 'text-gray-400'}`}>{p.name}{p.id === me ? '（自分）' : ''}</span>
                          <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded-sm border text-xs ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'}`}>{on ? '✓' : ''}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <button onClick={() => setShowTodos(v => !v)} role="switch" aria-checked={showTodos} className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left">
              <span className="flex-1 text-base text-gray-900">ToDoも表示</span>
              <span aria-hidden className={`relative h-6 w-10 rounded-full transition-colors ${showTodos ? 'bg-blue-600' : 'bg-gray-300'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${showTodos ? 'left-[1.15rem]' : 'left-0.5'}`} /></span>
            </button>
            {<button onClick={() => { setSheet(null); setShowSettings(true); }} className="w-full rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-800">Google連携の設定</button>}
            <button onClick={() => setSheet(null)} className="w-full rounded-lg bg-gray-900 px-3 py-3 text-base font-medium text-white">閉じる</button>
          </div>
        </Modal>
      )}

      {todoModal && (
        <TodoModal people={assignable} me={me} todo={todoModal.todo} defaultDue={todoModal.due} canEdit={todoModal.todo ? todoModal.todo.can_edit : true}
          onClose={() => setTodoModal(null)} onChanged={text => { setTodoModal(null); flash('success', text); load(); }} />
      )}

      {showSettings && (
        <GoogleSettings links={links} configured={googleConfigured} focusLink={sp.get('link')}
          onClose={() => setShowSettings(false)} onChanged={load} flash={flash} />
      )}
    </div>
  );
}

// Why the list of Google calendars could not be read, and what to do about it (the error codes of /api/calendar/links/:id/calendars)
const LIST_ERROR_TEXT: Record<string, string> = {
  api_disabled: 'Google Cloud で「Google Calendar API」が有効になっていません。管理者が Google Cloud Console の「APIとサービス → ライブラリ」で「Google Calendar API」を有効にして、数分たってから「もう一度読み込む」を押してください。',
  insufficient_scope: 'カレンダーを読み取る権限が許可されていません。「キャンセル」で連携をやり直し、Googleの確認画面で「カレンダーを表示」にチェックを入れて許可してください。',
  token_expired: 'Googleとの連携が切れています。「キャンセル」で連携をやり直してください。',
  google_api_failed: 'Googleカレンダーの一覧を読み込めませんでした。しばらくしてからもう一度お試しください。続くときは、管理者にサーバーのログ（[Google Calendar] calendarList failed）を確認してもらってください。',
};

function GoogleSettings({ links, configured, focusLink, onClose, onChanged, flash }: {
  links: Link[]; configured: boolean; focusLink: string | null;
  onClose: () => void; onChanged: () => void; flash: (t: 'success' | 'error', s: string) => void;
}) {
  const [options, setOptions] = useState<Record<string, { id: string; name: string; primary: boolean }[]>>({});
  const [listError, setListError] = useState<Record<string, string>>({});   // why the list of Google calendars could not be read
  const inp = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm w-full';

  const loadOptions = async (id: string) => {
    setListError(e => { const { [id]: _, ...rest } = e; return rest; });
    const res = await fetch(`/api/calendar/links/${id}/calendars`).catch(() => null);
    if (res?.ok) { const d = await res.json(); setOptions(o => ({ ...o, [id]: d.items })); return; }
    const d = await res?.json().catch(() => ({}));
    setListError(e => ({ ...e, [id]: d?.error ?? 'google_api_failed' }));
  };
  useEffect(() => {
    links.filter(l => !l.google_calendar_id && !options[l.id] && !listError[l.id]).forEach(l => { void loadOptions(l.id); });
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
      <p className="text-xs text-gray-500 mb-3">Googleの予定を、あなた自身のカレンダーに取り込みます（読み取り専用）。「予定あり」のみ表示にすると、タイトルや詳細は保存も表示もされません。</p>
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
                {!options[l.id] && !listError[l.id] && <p className="mt-1 text-xs text-gray-400">Googleカレンダーの一覧を読み込んでいます…</p>}
                {options[l.id]?.length === 0 && <p role="status" className="mt-1 text-xs text-amber-700">このGoogleアカウントには、読み取れるカレンダーがありません。別のアカウントで連携し直してください。</p>}
                {listError[l.id] && (
                  <div role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 space-y-1">
                    <p>{LIST_ERROR_TEXT[listError[l.id]] ?? LIST_ERROR_TEXT.google_api_failed}</p>
                    <button type="button" className="underline" onClick={() => loadOptions(l.id)}>もう一度読み込む</button>
                  </div>
                )}
                <button onClick={() => unlink(l.id)} className="mt-2 text-xs text-red-600 hover:underline">キャンセル</button>
              </div>
            ) : (
              <>
                <input className={inp} defaultValue={l.name} onBlur={e => e.target.value !== l.name && patch(l.id, { name: e.target.value })} aria-label="表示名" />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1"><input type="radio" checked={l.display_mode === 'busy_only'} onChange={() => patch(l.id, { display_mode: 'busy_only' })} />予定ありのみ</label>
                  <label className="flex items-center gap-1"><input type="radio" checked={l.display_mode === 'full'} onChange={() => patch(l.id, { display_mode: 'full' })} />詳細も表示</label>
                </div>
                {l.display_mode === 'busy_only' && (
                  <div><label className="text-xs text-gray-600">表示ラベル</label>
                    <input className={inp} defaultValue={l.busy_label} onBlur={e => e.target.value.trim() && e.target.value !== l.busy_label && patch(l.id, { busy_label: e.target.value })} /></div>
                )}
                <div className="text-xs text-gray-500">誰の予定: {l.linked_by.name} ・ 最終同期: {l.last_synced_at ? new Date(l.last_synced_at).toLocaleString('ja-JP') : '未同期'}</div>
                {l.last_error && <div className="text-xs text-red-600 wrap-break-word">エラー: {l.last_error}</div>}
                <div className="flex gap-3 text-xs">
                  <button onClick={() => sync(l.id)} className="text-blue-600 hover:underline">今すぐ同期</button>
                  <button onClick={() => unlink(l.id)} className="text-red-600 hover:underline">連携解除</button>
                </div>
              </>
            )}
          </div>
        ))}
        {configured ? (
          <a href="/api/calendar/google/auth" className="inline-block rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">＋ Googleカレンダーを連携</a>
        ) : (
          <p className="text-xs text-amber-600">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定のため、Google連携は利用できません。</p>
        )}
      </div>
      <div className="flex justify-end pt-4"><button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">閉じる</button></div>
    </Modal>
  );
}
