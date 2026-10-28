'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

// A button that opens a small panel of links. Closes on outside click, Escape, a click on any link, and navigation.
export default function Dropdown({ trigger, ariaLabel, active, align = 'left', children }: {
  trigger: ReactNode; ariaLabel?: string; active?: boolean; align?: 'left' | 'right'; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button" aria-haspopup="true" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
          active || open ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
        }`}
      >
        {trigger}
      </button>
      {open && (
        <div
          onClick={e => { if ((e.target as HTMLElement).closest('a,button')) setOpen(false); }}
          className={`absolute top-full mt-1.5 z-50 min-w-[18rem] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
