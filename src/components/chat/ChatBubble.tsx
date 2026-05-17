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

function Avatar({ userId, name }: { userId: string; name: string }) {
  return (
    <div className="w-7 h-7 rounded-full overflow-hidden bg-blue-100 flex items-center justify-center shrink-0 text-xs font-bold text-blue-600 select-none">
      <img
        src={`/api/users/${userId}/avatar`}
        alt={name}
        className="w-full h-full object-cover"
        onError={e => {
          e.currentTarget.style.display = 'none';
          (e.currentTarget.parentElement as HTMLElement).textContent = name[0]?.toUpperCase() ?? '?';
        }}
      />
    </div>
  );
}

function ReadReceipts({ reads, isMine, participantCount }: { reads: ChatMessage['reads']; isMine: boolean; participantCount: number }) {
  if (!isMine) return null;
  const allRead = reads.length >= participantCount - 1 && participantCount > 1;
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
      <div className={`flex mb-2 gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
        {!isMine && <Avatar userId={msg.senderId} name={msg.senderName} />}
        <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
          {!isMine && <span className="text-xs text-gray-500 mb-1">{msg.senderName}</span>}
          <div className="text-5xl leading-none select-none">
            {STICKER_MAP[msg.body] ?? msg.body}
          </div>
          <div className={`flex items-center gap-1 mt-1 ${isMine ? 'flex-row-reverse' : ''}`}>
            <span className="text-xs text-gray-400">{time}</span>
            <ReadReceipts reads={msg.reads} isMine={isMine} participantCount={participantCount} />
          </div>
        </div>
        {isMine && <div className="w-7 shrink-0" />}
      </div>
    );
  }

  return (
    <div className={`flex mb-2 gap-2 items-start ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isMine && <Avatar userId={msg.senderId} name={msg.senderName} />}
      <div className={`flex flex-col max-w-[72%] ${isMine ? 'items-end' : 'items-start'}`}>
        {!isMine && <span className="text-xs text-gray-500 mb-1">{msg.senderName}</span>}
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
      {isMine && <div className="w-7 shrink-0" />}
    </div>
  );
}
