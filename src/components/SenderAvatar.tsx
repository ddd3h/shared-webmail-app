'use client';

import { useState } from 'react';

const BG_COLORS = [
  'bg-rose-500', 'bg-pink-500', 'bg-fuchsia-500', 'bg-purple-500', 'bg-violet-500',
  'bg-indigo-500', 'bg-blue-500', 'bg-sky-500', 'bg-cyan-500', 'bg-teal-500',
  'bg-emerald-500', 'bg-green-500', 'bg-lime-600', 'bg-amber-500', 'bg-orange-500',
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initialOf(name: string | null, email: string | null): string {
  const n = (name || '').trim();
  if (n) return n[0].toUpperCase();
  const e = (email || '').trim();
  if (e) return e[0].toUpperCase();
  return '?';
}

type Props = {
  email: string | null;
  name?: string | null;
  size?: number; // px
  className?: string;
};

// 送信者アイコン: BIMI/企業favicon/Gravatar があれば画像、なければイニシャル
export default function SenderAvatar({ email, name, size = 32, className = '' }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const key = (email || name || '?').toLowerCase();
  const bg = BG_COLORS[hashString(key) % BG_COLORS.length];
  const showImg = !!email && !failed;

  return (
    <div
      className={`relative flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center select-none ${loaded ? 'bg-white ring-1 ring-zinc-200' : bg} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {!loaded && (
        <span className="text-white font-semibold" style={{ fontSize: size * 0.44 }}>
          {initialOf(name ?? null, email)}
        </span>
      )}
      {showImg && (
        <img
          src={`/api/sender-icon?email=${encodeURIComponent(email)}`}
          alt=""
          loading="lazy"
          className={`absolute inset-0 w-full h-full object-contain ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
