'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import InlineChatPanel from '@/components/chat/InlineChatPanel';

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

interface ThreadDetail {
  id: string;
  subject: string;
  status: string;
  mailbox: { name: string; type: string };
  assigned_user: { id: string; name: string } | null;
  messages: {
    id: string;
    direction: string;
    from: { name: string | null; email: string };
    sent_at: string;
    text_body: string | null;
  }[];
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

const STATUS_LABEL: Record<string, string> = {
  open: '未対応', in_progress: '対応中', done: '完了', archived: 'アーカイブ',
};
const STATUS_COLOR: Record<string, string> = {
  open: 'bg-rose-100 text-rose-700',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-gray-100 text-gray-500',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return '昨日';
  if (diffDays < 7) return `${diffDays}日前`;
  return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function previewBody(body: string, kind: string) {
  if (kind === 'sticker') return '🎉 ステッカー';
  return body.length > 36 ? body.slice(0, 36) + '…' : body;
}

function ThreadListItem({ thread, selected, onClick }: {
  thread: ChatThread;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-gray-100 ${
        selected
          ? 'bg-green-50 border-l-4 border-l-green-500'
          : 'hover:bg-gray-50 border-l-4 border-l-transparent'
      }`}
    >
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0 text-green-600">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className={`text-sm truncate ${thread.unreadCount > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
            {thread.threadSubject}
          </span>
          {thread.lastMessage && (
            <span className="text-xs text-gray-400 shrink-0">{formatTime(thread.lastMessage.createdAt)}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-xs text-gray-500 truncate">
            {thread.lastMessage
              ? `${thread.lastMessage.senderName}: ${previewBody(thread.lastMessage.body, thread.lastMessage.kind)}`
              : ''}
          </span>
          {thread.unreadCount > 0 && (
            <span className="shrink-0 bg-green-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {thread.unreadCount > 99 ? '99+' : thread.unreadCount}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{thread.mailboxName}</span>
      </div>
    </button>
  );
}

function EmailPreviewPanel({ threadId }: { threadId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useSWR<ThreadDetail>(`/api/threads/${threadId}`, fetcher);

  if (!data) {
    return (
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <div className="h-4 bg-gray-100 rounded animate-pulse w-3/4 mb-1" />
        <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
      </div>
    );
  }

  const lastMsg = data.messages[data.messages.length - 1];

  return (
    <div className="shrink-0 border-b border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm truncate">{data.subject}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOR[data.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {STATUS_LABEL[data.status] ?? data.status}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 flex-wrap">
            <span>{data.mailbox.name}</span>
            {data.assigned_user && <span>担当: {data.assigned_user.name}</span>}
            <span>{data.messages.length}通</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/threads/${threadId}`} className="text-xs text-blue-600 hover:underline">
            メールを開く
          </Link>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-gray-400 hover:text-gray-600"
            aria-label={expanded ? '折りたたむ' : '展開'}
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      {expanded && lastMsg && (
        <div className="px-4 pb-3 border-t border-gray-100">
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-700">{lastMsg.from.name ?? lastMsg.from.email}</span>
            <span>{formatTime(lastMsg.sent_at)}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${lastMsg.direction === 'incoming' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
              {lastMsg.direction === 'incoming' ? '受信' : '送信'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap line-clamp-4">
            {lastMsg.text_body?.trim() ?? '(本文なし)'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { data, isLoading } = useSWR<ChatThread[]>('/api/chat', fetcher, { refreshInterval: 15000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileShowDetail(true);
  };

  const selected = data?.find(t => t.threadId === selectedId);

  return (
    <div className="flex overflow-hidden bg-white" style={{ height: 'var(--chat-h)' }}>
      {/* ── Left: thread list ── */}
      <div className={`flex flex-col overflow-hidden border-r border-gray-200 bg-white w-full md:w-80 lg:w-96 shrink-0 ${mobileShowDetail ? 'hidden md:flex' : 'flex'}`}>
        {/* fixed header */}
        <div className="shrink-0 px-4 py-3 border-b border-gray-100 bg-white">
          <h1 className="font-bold text-gray-900">チャット</h1>
        </div>

        {/* scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex justify-center py-12">
              <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!isLoading && data?.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-12 px-4">
              チャットメッセージがありません
            </p>
          )}
          {data?.map(t => (
            <ThreadListItem
              key={t.threadId}
              thread={t}
              selected={t.threadId === selectedId}
              onClick={() => handleSelect(t.threadId)}
            />
          ))}
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      <div className={`flex-1 flex flex-col overflow-hidden min-w-0 ${mobileShowDetail ? 'flex' : 'hidden md:flex'}`}>
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
            <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-sm">スレッドを選択してください</span>
          </div>
        ) : (
          <>
            {/* mobile back bar */}
            <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
              <button
                onClick={() => setMobileShowDetail(false)}
                className="text-green-600 flex items-center gap-1 text-sm font-medium shrink-0 whitespace-nowrap"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm font-medium text-gray-700 truncate">{selected?.threadSubject}</span>
            </div>

            {/* email preview (fixed height, collapsible) */}
            <EmailPreviewPanel key={`ep-${selectedId}`} threadId={selectedId} />

            {/* inline chat — flex-1 fills remaining, handles own scroll + fixed input */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <InlineChatPanel key={`chat-${selectedId}`} threadId={selectedId} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
