'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (slug: string) => void;
  onClose: () => void;
}

export default function StickerPicker({ anchorRef, onSelect, onClose }: Props) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    const picker = pickerRef.current;
    if (!anchor || !picker) return;

    const rect = anchor.getBoundingClientRect();
    const pickerH = picker.offsetHeight || 200;
    const top = rect.top - pickerH - 8;

    setStyle({
      position: 'fixed',
      top: Math.max(8, top),
      left: Math.max(8, rect.left),
      zIndex: 9999,
      visibility: 'visible',
    });
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={pickerRef} style={style} className="bg-white border border-gray-200 rounded-xl shadow-xl p-2">
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
    </div>,
    document.body,
  );
}
