'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setNotificationCount } from '@/hooks/useNotificationCount';
import { ago } from '@/lib/time-ago';

type Item = { id: string; type: string; title: string; body: string; url: string; created_at: string; read: boolean };
type Page = { items: Item[]; unread: number; next: string | null };

// The kind of news, for the small mark on the left
function kindOf(type: string): { label: string; tone: string } {
  if (type === 'new_message' || type === 'thread_updated') return { label: 'メール', tone: 'bg-blue-100 text-blue-700' };
  if (type.startsWith('security_')) return { label: 'セキュリティ', tone: 'bg-red-100 text-red-700' };
  if (type.startsWith('todo')) return { label: 'ToDo', tone: 'bg-emerald-100 text-emerald-700' };
  if (/^(expense|trip|payment|payslip|work|attendance|bank)/.test(type)) return { label: '申請・給与', tone: 'bg-amber-100 text-amber-700' };
  if (type.startsWith('evaluation')) return { label: '人事評価', tone: 'bg-violet-100 text-violet-700' };
  return { label: 'お知らせ', tone: 'bg-gray-100 text-gray-600' };
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (before?: string) => {
    const qs = new URLSearchParams({ limit: '30' });
    if (onlyUnread) qs.set('unread', '1');
    if (before) qs.set('before', before);
    const res = await fetch(`/api/notifications?${qs}`, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) { setError(true); return null; }
    setError(false);
    return (await res.json()) as Page;
  }, [onlyUnread]);

  useEffect(() => {
    let current = true; // a late answer for the previous filter must not overwrite the new one
    setItems(null);
    load().then(p => { if (current && p) { setItems(p.items); setUnread(p.unread); setNext(p.next); setNotificationCount(p.unread); } });
    return () => { current = false; };
  }, [load]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    const p = await load(next);
    if (p) { setItems(cur => [...(cur ?? []), ...p.items]); setNext(p.next); }
    setMore(false);
  }

  async function markRead(body: { ids?: string[]; all?: boolean }) {
    const res = await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) return;
    const { unread: left } = await res.json();
    setUnread(left);
    setNotificationCount(left);
  }

  async function open(it: Item) {
    if (!it.read) {
      setItems(cur => cur && cur.map(x => (x.id === it.id ? { ...x, read: true } : x)));
      await markRead({ ids: [it.id] });
    }
    router.push(it.url);
  }

  async function readAll() {
    await markRead({ all: true });
    setItems(cur => cur && (onlyUnread ? [] : cur.map(x => ({ ...x, read: true }))));
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-bold text-gray-900">通知</h1>
        <button onClick={readAll} disabled={unread === 0} className="btn btn-secondary btn-sm disabled:opacity-40">すべて既読にする</button>
        <Link href="/profile#notifications" className="btn btn-secondary btn-sm" aria-label="通知の設定">設定</Link>
      </div>

      <div className="flex gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="表示">
        {[{ v: false, label: 'すべて' }, { v: true, label: `未読${unread > 0 ? `（${unread}）` : ''}` }].map(t => (
          <button key={String(t.v)} role="tab" aria-selected={onlyUnread === t.v} onClick={() => setOnlyUnread(t.v)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium ${onlyUnread === t.v ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'}`}>{t.label}</button>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">通知を読み込めませんでした。</p>}

      {items === null && !error ? (
        <p className="py-10 text-center text-sm text-gray-400">読み込み中…</p>
      ) : items && items.length === 0 ? (
        <div className="card py-16 text-center text-sm text-gray-400">{onlyUnread ? '未読の通知はありません' : '通知はまだありません'}</div>
      ) : (
        <ul className="card divide-y divide-gray-100 overflow-hidden p-0" aria-label="通知の一覧">
          {items?.map(it => {
            const kind = kindOf(it.type);
            return (
              <li key={it.id}>
                <button onClick={() => open(it)} data-unread={!it.read} className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${it.read ? 'bg-white hover:bg-gray-50' : 'bg-blue-50/50 hover:bg-blue-50'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${it.read ? 'bg-transparent' : 'bg-blue-600'}`} aria-label={it.read ? undefined : '未読'} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${kind.tone}`}>{kind.label}</span>
                      <span className="ml-auto shrink-0 text-xs text-gray-400">{ago(it.created_at)}</span>
                    </span>
                    <span className={`mt-1 block text-sm ${it.read ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{it.title}</span>
                    {it.body && <span className="mt-0.5 block whitespace-pre-line text-xs text-gray-500 line-clamp-2">{it.body}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {next && <div className="flex justify-center"><button onClick={loadMore} disabled={more} className="btn btn-secondary btn-sm">{more ? '読み込み中…' : 'もっと見る'}</button></div>}
    </div>
  );
}
