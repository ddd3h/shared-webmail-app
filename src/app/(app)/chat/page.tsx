'use client';

import useSWR from 'swr';
import Link from 'next/link';

interface ChatThread {
  threadId: string;
  threadSubject: string;
  mailboxName: string;
  lastMessage: {
    body: string;
    kind: string;
    senderName: string;
    createdAt: string;
  } | null;
  unreadCount: number;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return '昨日';
  if (diffDays < 7) return `${diffDays}日前`;
  return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function previewBody(body: string, kind: string) {
  if (kind === 'sticker') return '🎉 ステッカー';
  return body.length > 40 ? body.slice(0, 40) + '…' : body;
}

export default function ChatPage() {
  const { data, isLoading } = useSWR<ChatThread[]>('/api/chat', fetcher, { refreshInterval: 15000 });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-4">チャット</h1>
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {data && data.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-12">
          チャット可能なスレッドがありません
        </p>
      )}
      {data && data.length > 0 && (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {data.map(t => (
            <Link
              key={t.threadId}
              href={`/threads/${t.threadId}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              {/* Avatar placeholder */}
              <div className="w-11 h-11 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-sm text-gray-900 truncate">{t.threadSubject}</span>
                  {t.lastMessage && (
                    <span className="text-xs text-gray-400 shrink-0">{formatTime(t.lastMessage.createdAt)}</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-gray-500 truncate">
                    {t.lastMessage
                      ? `${t.lastMessage.senderName}: ${previewBody(t.lastMessage.body, t.lastMessage.kind)}`
                      : 'チャットなし'}
                  </span>
                  {t.unreadCount > 0 && (
                    <span className="shrink-0 bg-green-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                      {t.unreadCount > 99 ? '99+' : t.unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{t.mailboxName}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
