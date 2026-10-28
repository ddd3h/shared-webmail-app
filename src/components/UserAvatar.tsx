'use client';
import { useState } from 'react';

const initialOf = (name: string) => (name.trim() ? [...name.trim()][0].toUpperCase() : '?');

// The signed-in person's picture (the one on the profile page: /api/user/avatar). The initial is drawn underneath, so there is no
// empty circle while it loads and it stays when the person has no picture.
export default function UserAvatar({ name, className = 'h-6 w-6 text-xs' }: { name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 font-semibold text-gray-700 ${className}`}>
      {initialOf(name)}
      {!failed && name && <img src="/api/user/avatar" alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />}
    </span>
  );
}
