'use client';

const STICKERS = [
  { slug: 'thumbsup', emoji: '👍' },
  { slug: 'heart',    emoji: '❤️' },
  { slug: 'laugh',    emoji: '😂' },
  { slug: 'clap',     emoji: '👏' },
  { slug: 'fire',     emoji: '🔥' },
  { slug: 'star',     emoji: '⭐' },
  { slug: 'ok',       emoji: '👌' },
  { slug: 'wave',     emoji: '👋' },
  { slug: 'rocket',   emoji: '🚀' },
  { slug: 'party',    emoji: '🎉' },
  { slug: 'think',    emoji: '🤔' },
  { slug: 'cry',      emoji: '😢' },
  { slug: 'wow',      emoji: '😮' },
  { slug: 'strong',   emoji: '💪' },
  { slug: 'check',    emoji: '✅' },
  { slug: 'eyes',     emoji: '👀' },
];

interface Props {
  onSelect: (slug: string) => void;
  onClose: () => void;
}

export default function StickerPicker({ onSelect, onClose }: Props) {
  return (
    <div className="absolute bottom-full mb-2 right-0 bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-10">
      <div className="grid grid-cols-4 gap-1">
        {STICKERS.map(s => (
          <button
            key={s.slug}
            onClick={() => { onSelect(s.slug); onClose(); }}
            className="text-2xl w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors"
          >
            {s.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
