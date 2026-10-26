'use client';

// The one round "＋" button of a phone screen, floating above the bottom bar. It only exists on phones: on a wide screen
// the same action is a normal button in the page header.
export default function Fab({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="md:hidden fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-3xl leading-none text-white shadow-lg active:bg-blue-700"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 6.5rem)' }}>
      <span aria-hidden>＋</span>
    </button>
  );
}
