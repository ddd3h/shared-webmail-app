import type { ReactNode } from 'react';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        :root {
          /* mobile: nav bar ~84px + safe-area */
          --chat-h: calc(100dvh - 5.5rem - env(safe-area-inset-bottom, 0px));
        }
        @media (min-width: 768px) {
          :root {
            /* desktop: just top nav 3.5rem, no bottom nav */
            --chat-h: calc(100dvh - 3.5rem);
          }
        }
      `}</style>
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6 -mb-24 md:-mb-6">
        {children}
      </div>
    </>
  );
}
