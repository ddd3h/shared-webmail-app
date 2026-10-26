'use client';
import { useId, useState, type ReactNode } from 'react';

// A card whose body is folded away on a phone (tap the title row to open it) and always open on a wide screen.
// The body stays in the page while folded, so a form inside keeps what was typed. `badge` is a short note shown
// next to the title while folded ("3件", "未設定"), so the closed row still tells something.
export default function FoldCard({ title, label, badge, defaultOpen = false, className = 'card p-5', bodyClass = 'space-y-2', children }: {
  title: ReactNode; label?: string; badge?: ReactNode; defaultOpen?: boolean; className?: string; bodyClass?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section aria-label={label} className={`${className} max-md:p-0`}>
      <h2 className="font-semibold text-gray-900 md:mb-3">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}
          className="flex w-full items-center gap-2 p-4 text-left active:bg-gray-50 md:cursor-default md:p-0 md:active:bg-transparent">
          <span className="min-w-0 flex-1">{title}</span>
          {badge && <span className="shrink-0 text-xs font-normal text-gray-500 md:hidden">{badge}</span>}
          <svg aria-hidden className={`h-4 w-4 shrink-0 text-gray-400 transition-transform md:hidden ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
      </h2>
      <div id={id} className={`${open ? 'block' : 'hidden'} md:block px-4 pb-4 md:p-0 ${bodyClass}`}>{children}</div>
    </section>
  );
}
