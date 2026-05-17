'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '@/hooks/useChat';
import ChatBubble from './ChatBubble';
import TypingIndicator from './TypingIndicator';
import StickerPicker from './StickerPicker';

interface Props {
  threadId: string;
  isTeam: boolean;
}

export default function ChatPopup({ threadId, isTeam }: Props) {
  const [open, setOpenState] = useState(false);
  const [input, setInput] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const atBottomRef = useRef(true);

  const {
    messages,
    participants,
    typingUsers,
    me,
    connected,
    hasMore,
    sendMessage,
    notifyTyping,
    loadMore,
    setOpen: setChatOpen,
  } = useChat(isTeam ? threadId : null);

  // Track unread for badge
  useEffect(() => {
    if (!me) return;
    const unread = messages.filter(
      m => m.senderId !== me.userId && !m.reads.some(r => r.userId === me.userId),
    ).length;
    setUnreadCount(open ? 0 : unread);
  }, [messages, me, open]);

  // Notify hook when panel opens/closes
  const handleSetOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      setChatOpen(v);
      if (v) setUnreadCount(0);
    },
    [setChatOpen],
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!open || !listRef.current) return;
    if (atBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  const onScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    atBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
    if (scrollTop < 60 && hasMore) loadMore();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendMessage(text, 'text');
    // Scroll after optimistic append
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  };

  const handleSticker = async (slug: string) => {
    await sendMessage(slug, 'sticker');
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  };

  if (!isTeam) return null;

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          onClick={() => handleSetOpen(true)}
          className="fixed right-6 bottom-24 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
          aria-label="チャットを開く"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed right-6 bottom-24 z-50 w-80 h-[480px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-green-500 text-white shrink-0">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="font-semibold text-sm">チャット</span>
              <span className="text-xs opacity-80">({participants.length}人)</span>
            </div>
            <div className="flex items-center gap-2">
              {!connected && (
                <span className="text-xs opacity-70">接続中…</span>
              )}
              <button
                onClick={() => handleSetOpen(false)}
                className="text-white/80 hover:text-white"
                aria-label="閉じる"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            onScroll={onScroll}
            className="flex-1 overflow-y-auto px-3 py-2 bg-gray-50 flex flex-col"
          >
            {hasMore && (
              <button
                onClick={loadMore}
                className="text-xs text-green-600 hover:underline self-center mb-2"
              >
                過去のメッセージを読み込む
              </button>
            )}
            {messages.length === 0 && connected && (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                チャットを始めましょう
              </div>
            )}
            {messages.map(msg => (
              <ChatBubble
                key={msg.id}
                msg={msg}
                isMine={msg.senderId === me?.userId}
                participantCount={participants.length}
              />
            ))}
            <TypingIndicator typingUsers={typingUsers} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-gray-200 bg-white px-2 py-2 flex items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setShowStickers(v => !v)}
                className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-green-600 rounded-full hover:bg-gray-100"
                aria-label="ステッカー"
              >
                😊
              </button>
              {showStickers && (
                <StickerPicker onSelect={handleSticker} onClose={() => setShowStickers(false)} />
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); notifyTyping(); }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="メッセージを入力…"
              className="flex-1 text-sm px-3 py-1.5 rounded-full border border-gray-200 focus:outline-none focus:border-green-400 bg-gray-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-8 h-8 flex items-center justify-center bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white rounded-full transition-colors"
              aria-label="送信"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
