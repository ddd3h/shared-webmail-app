'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TodoModal from '@/components/todos/TodoModal';
import { canTick, setDone, TEAM, type Person, type Todo } from '@/components/todos/types';

type Mailbox = { id: string; display_name: string; type: string };
type Status = 'open' | 'done' | 'all';
const STATUS: { key: Status; label: string }[] = [{ key: 'open', label: '未完了' }, { key: 'done', label: '完了' }, { key: 'all', label: 'すべて' }];
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function dueLabel(due: string, today: string) {
  const d = new Date(`${due}T00:00:00`);
  const text = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
  return due === today ? `今日 ${text}` : text;
}

export default function TodosPage() {
  return <Suspense fallback={null}><TodosView /></Suspense>;
}

function TodosView() {
  const sp = useSearchParams();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [mailboxId, setMailboxId] = useState(sp.get('mailbox') || '');
  const [status, setStatus] = useState<Status>('open');
  const [assignee, setAssignee] = useState('all');
  const [items, setItems] = useState<Todo[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(''); // the browser's today; unknown while rendering on the server
  const [editing, setEditing] = useState<Todo | 'new' | null>(null);
  const [quick, setQuick] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  useEffect(() => {
    setToday(ymd(new Date()));
    fetch('/api/mailboxes?mine=1').then(r => r.json()).then(d => {
      const list: Mailbox[] = (d.items || []).filter((m: any) => m.is_active && m.user_permissions?.can_view);
      setMailboxes(list);
      setMailboxId(cur => cur || list.find(m => m.type === 'team')?.id || list[0]?.id || '');
      if (list.length === 0) setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const load = useCallback(async () => {
    if (!mailboxId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/todos?mailboxId=${mailboxId}&status=${status}&assignee=${assignee}`);
      if (res.ok) { const d = await res.json(); setItems(d.items); setPeople(d.people); setMe(d.me); setCanEdit(d.permissions.can_edit); }
    } finally { setLoading(false); }
  }, [mailboxId, status, assignee]);
  useEffect(() => { load(); }, [load]);

  async function tick(t: Todo) {
    if (await setDone(t.id, !t.done)) load(); else flash('error', '更新できませんでした');
  }

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quick.trim()) return;
    const res = await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mailboxId, title: quick }) });
    if (res.ok) { setQuick(''); load(); } else flash('error', '追加できませんでした');
  }

  const open = items.filter(t => !t.done).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-40">
          <h1 className="text-xl font-bold text-gray-900">ToDo</h1>
          <p className="text-xs text-gray-500 mt-0.5">チームで共有するやること。期限を付けるとカレンダーにも表示されます</p>
        </div>
        <select aria-label="メールアカウント" value={mailboxId} onChange={e => setMailboxId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
          {mailboxes.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        {canEdit && <button onClick={() => setEditing('new')} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">＋ ToDo</button>}
      </div>

      {msg && <div role="status" className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</div>}
      {mailboxes.length === 0 && !loading && <p className="text-sm text-gray-500">閲覧できるメールアカウントがありません。</p>}

      {canEdit && (
        <form onSubmit={quickAdd} className="flex gap-2">
          <input aria-label="ToDoをすばやく追加" value={quick} onChange={e => setQuick(e.target.value)} maxLength={200} placeholder="やることを入力して Enter で追加"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
          <button type="submit" disabled={!quick.trim()} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">追加</button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {STATUS.map(s => (
          <button key={s.key} onClick={() => setStatus(s.key)} aria-pressed={status === s.key}
            className={`rounded-full border px-3 py-1 text-xs ${status === s.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{s.label}</button>
        ))}
        <select aria-label="担当で絞り込み" value={assignee} onChange={e => setAssignee(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs bg-white">
          <option value="all">担当: 全員</option>
          <option value="me">担当: 自分</option>
          <option value={TEAM}>担当: チーム全体</option>
          {people.filter(p => p.id !== me).map(p => <option key={p.id} value={p.id}>担当: {p.name}</option>)}
        </select>
        {status !== 'done' && <span className="text-xs text-gray-500">未完了 {open}件</span>}
      </div>

      {loading && items.length === 0 ? <p className="text-sm text-gray-400">読み込み中…</p>
        : items.length === 0 ? <p className="text-sm text-gray-400">ToDoはありません</p> : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {items.map(t => (
            <li key={t.id} className="flex items-start gap-3 p-3">
              <button onClick={() => tick(t)} disabled={!canTick(t, canEdit, me)} role="checkbox" aria-checked={t.done} aria-label={`${t.title}を${t.done ? '未完了に戻す' : '完了にする'}`}
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${t.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white hover:border-blue-500'} disabled:opacity-40`}>
                {t.done ? '✓' : ''}
              </button>
              <button onClick={() => setEditing(t)} className="min-w-0 flex-1 text-left">
                <div className={`text-sm wrap-break-word ${t.done ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'}`}>{t.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  {t.due_date && (
                    <span className={t.overdue ? 'font-medium text-red-600' : t.due_date === today && !t.done ? 'font-medium text-amber-600' : ''}>
                      {t.overdue ? '期限切れ ' : '期限 '}{dueLabel(t.due_date, today)}
                    </span>
                  )}
                  <span>担当: {t.assignee ? `${t.assignee.name}${t.assignee.id === me ? '（自分）' : ''}` : 'チーム全体'}</span>
                  {t.done && t.done_by && <span>{t.done_by} が完了</span>}
                </div>
                {t.description && <div className="mt-1 text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap wrap-break-word">{t.description}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TodoModal mailboxId={mailboxId} people={people} me={me} todo={editing === 'new' ? undefined : editing} canEdit={canEdit}
          onClose={() => setEditing(null)} onChanged={text => { setEditing(null); flash('success', text); load(); }} />
      )}
    </div>
  );
}
