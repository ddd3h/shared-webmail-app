'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import ChatBubble from './ChatBubble';
import TypingIndicator from './TypingIndicator';
import StickerPicker from './StickerPicker';

interface Props {
  threadId: string;
}

export default function InlineChatPanel({ threadId }: Props) {
  const [input, setInput] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickerBtnRef = useRef<HTMLButtonElement>(null);
  const atBottomRef = useRef(true);

  const { messages, participants, typingUsers, me, connected, hasMore, sendMessage, notifyTyping, loadMore, setOpen } =
    useChat(threadId);

  // Always open when mounted
  useEffect(() => {
    setOpen(true);
    return () => setOpen(false);
  }, [setOpen]);

  useEffect(() => {
    if (!listRef.current || !atBottomRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

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

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-50">
      {/* header strip */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-green-500 text-white text-sm">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="font-semibold">チャット</span>
          <span className="opacity-75 text-xs">({participants.length}人)</span>
        </div>
        {!connected && <span className="text-xs opacity-70">接続中…</span>}
      </div>

      {/* messages */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col min-h-0">
        {hasMore && (
          <button onClick={loadMore} className="text-xs text-green-600 hover:underline self-center mb-2">
            過去のメッセージを読み込む
          </button>
        )}
        {messages.length === 0 && connected && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            チャットを始めましょう
          </div>
        )}
        {messages.map(msg => (
          <ChatBubble key={msg.id} msg={msg} isMine={msg.senderId === me?.userId} participantCount={participants.length} />
        ))}
        <TypingIndicator typingUsers={typingUsers} />
      </div>

      {/* input */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-2 py-2 flex items-center gap-1">
        <div className="relative">
          <button
            ref={stickerBtnRef}
            onClick={() => setShowStickers(v => !v)}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-green-600 rounded-full hover:bg-gray-100"
          >
            😊
          </button>
          {showStickers && (
            <StickerPicker anchorRef={stickerBtnRef} onSelect={handleSticker} onClose={() => setShowStickers(false)} />
          )}
        </div>
        <input
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
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
