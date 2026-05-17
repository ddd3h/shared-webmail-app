import type { ReactNode } from 'react';

// Cancel out the parent <main>'s padding so the chat page can be full-bleed
export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6 -mb-24 md:-mb-6">
      {children}
    </div>
  );
}
