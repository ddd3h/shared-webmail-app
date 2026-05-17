import type { ReactNode } from 'react';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        /* mobile: top=0, bottom above bottom-nav + safe-area */
        :root {
          --chat-top: 0px;
          --chat-bottom: calc(env(safe-area-inset-bottom, 0px) + 5.25rem);
        }
        /* desktop: top below sticky top-nav (h-14=3.5rem), bottom=0 */
        @media (min-width: 768px) {
          :root {
            --chat-top: 3.5rem;
            --chat-bottom: 0px;
          }
        }
      `}</style>
      {children}
    </>
  );
}
