'use client';
import { useState } from 'react';
import Modal from '@/components/Modal';
import { TEAM, type Person, type Todo } from './types';

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500';

// Add a to-do, or edit / delete one. Used by the ToDo page and by the calendar.
export default function TodoModal({ mailboxId, people, me, todo, defaultDue, canEdit, onClose, onChanged }: {
  mailboxId: string; people: Person[]; me: string; todo?: Todo; defaultDue?: string; canEdit: boolean;
  onClose: () => void; onChanged: (message: string) => void;
}) {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [description, setDescription] = useState(todo?.description ?? '');
  const [due, setDue] = useState(todo?.due_date ?? defaultDue ?? '');
  const [assignee, setAssignee] = useState(todo ? todo.assignee?.id ?? TEAM : TEAM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) { setError('内容を入力してください'); return; }
    setBusy(true); setError('');
    const body = { title, description, due_date: due || null, assignee_id: assignee === TEAM ? null : assignee };
    const res = todo
      ? await fetch(`/api/todos/${todo.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, mailboxId }) });
    setBusy(false);
    if (res.ok) onChanged('保存しました'); else setError('保存に失敗しました。入力内容を確認してください');
  }

  async function remove() {
    if (!todo || !confirm('このToDoを削除しますか？')) return;
    const res = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
    if (res.ok) onChanged('削除しました'); else setError('削除に失敗しました');
  }

  return (
    <Modal title={todo ? 'ToDoを編集' : 'ToDoを追加'} onClose={onClose}>
      <div className="space-y-3">
        <input className={inp} aria-label="ToDoの内容" placeholder="やること" value={title} disabled={!canEdit} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); }} autoFocus enterKeyHint="done" />
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-600" htmlFor="todo-due">期限（カレンダーに表示）</label>
            <input id="todo-due" className={inp} type="date" value={due} disabled={!canEdit} onChange={e => setDue(e.target.value)} /></div>
          <div><label className="text-xs text-gray-600" htmlFor="todo-assignee">担当</label>
            <select id="todo-assignee" className={inp} value={assignee} disabled={!canEdit} onChange={e => setAssignee(e.target.value)}>
              <option value={TEAM}>チーム全体</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === me ? '（自分）' : ''}</option>)}
            </select></div>
        </div>
        <textarea className={inp} rows={3} aria-label="メモ" placeholder="メモ" value={description} disabled={!canEdit} onChange={e => setDescription(e.target.value)} />
        {todo && <p className="text-xs text-gray-400">{todo.created_by ? `${todo.created_by} が作成` : ''}{todo.done && todo.done_by ? `　${todo.done_by} が完了` : ''}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex items-center gap-2 pt-4">
        {canEdit && todo && <button onClick={remove} className="text-sm text-red-600 hover:underline">削除</button>}
        <div className="flex-1" />
        <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">閉じる</button>
        {canEdit && <button onClick={save} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">保存</button>}
      </div>
    </Modal>
  );
}
