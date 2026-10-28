'use client';
import type { ReactNode } from 'react';

// A dialog that slides up on phones and sits in the middle on desktop; clicking the dark area closes it.
export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-70 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="w-full md:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 md:hidden" />
        <h3 className="text-base font-semibold text-gray-900 mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
