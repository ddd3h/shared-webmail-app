'use client';

import { ChatMessage } from '@/hooks/useChat';

const STICKER_MAP: Record<string, string> = {
  thumbsup: '👍',
  heart: '❤️',
  laugh: '😂',
  clap: '👏',
  fire: '🔥',
  star: '⭐',
  ok: '👌',
  wave: '👋',
  rocket: '🚀',
  party: '🎉',
  think: '🤔',
  cry: '😢',
  wow: '😮',
  strong: '💪',
  check: '✅',
  eyes: '👀',
};

interface Props {
  msg: ChatMessage;
  isMine: boolean;
  participantCount: number;
}

function ReadReceipts({ reads, isMine, participantCount }: { reads: ChatMessage['reads']; isMine: boolean; participantCount: number }) {
  if (!isMine) return null;
  const readCount = reads.length;
  // Everyone else has read = double check
  const allRead = readCount >= participantCount - 1 && participantCount > 1;
  return (
    <span className={`text-xs select-none ${allRead ? 'text-blue-500' : 'text-gray-400'}`}>
      {allRead ? '✓✓' : '✓'}
    </span>
  );
}

export default function ChatBubble({ msg, isMine, participantCount }: Props) {
  const isSticker = msg.kind === 'sticker';
  const time = new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  if (isSticker) {
    return (
      <div className={`flex flex-col mb-2 ${isMine ? 'items-end' : 'items-start'}`}>
        {!isMine && <span className="text-xs text-gray-500 mb-1 ml-1">{msg.senderName}</span>}
        <div className="text-5xl leading-none select-none">
          {STICKER_MAP[msg.body] ?? msg.body}
        </div>
        <div className={`flex items-center gap-1 mt-1 ${isMine ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs text-gray-400">{time}</span>
          <ReadReceipts reads={msg.reads} isMine={isMine} participantCount={participantCount} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col mb-2 max-w-[75%] ${isMine ? 'self-end items-end' : 'self-start items-start'}`}>
      {!isMine && <span className="text-xs text-gray-500 mb-1 ml-2">{msg.senderName}</span>}
      <div
        className={`px-3 py-2 rounded-2xl text-sm break-words whitespace-pre-wrap shadow-sm ${
          isMine
            ? 'bg-blue-500 text-white rounded-br-sm'
            : 'bg-white text-gray-900 rounded-bl-sm border border-gray-200'
        } ${msg.optimistic ? 'opacity-60' : ''}`}
      >
        {msg.body}
      </div>
      <div className={`flex items-center gap-1 mt-0.5 ${isMine ? 'flex-row-reverse' : ''}`}>
        <span className="text-xs text-gray-400">{time}</span>
        <ReadReceipts reads={msg.reads} isMine={isMine} participantCount={participantCount} />
      </div>
    </div>
  );
}
