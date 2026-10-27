import { Suspense } from 'react';
import type { ReactNode } from 'react';
import Nav from '@/components/Nav';
import SessionKeeper from '@/components/SessionKeeper';
import IdleLogout from '@/components/IdleLogout';

// The menu reads the current address (usePathname), which is only known when a request comes in. It is wrapped in
// Suspense so everything else on the page can be prepared in advance; the empty bar keeps the layout from jumping.
const NavPlaceholder = () => <div aria-hidden className="hidden md:block h-14 border-b border-gray-200 bg-white" />;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionKeeper />
      <IdleLogout />
      <Suspense fallback={<NavPlaceholder />}><Nav /></Suspense>
      <main className="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        {children}
      </main>
    </>
  );
}
