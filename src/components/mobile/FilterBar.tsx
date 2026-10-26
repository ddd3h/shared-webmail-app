'use client';
import Fab from './Fab';

// The row above a list: status filters and the button that makes a new one.
// Wide screen: pills that wrap, the button on the right. Phone: the pills stay on ONE row you can swipe sideways
// (nothing folds into a second line), and the button becomes the round "＋" floating above the bottom bar.
export type Filter = { k: string; l: string };

export default function FilterBar({ filters, value, onChange, action }: {
  filters: Filter[]; value: string; onChange: (k: string) => void; action?: { label: string; onClick: () => void; className: string };
}) {
  return (
    <>
      <div className="-mx-2 flex items-center gap-2 overflow-x-auto px-2 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [scrollbar-width:none]">
        {filters.map(f => (
          <button key={f.k} onClick={() => onChange(f.k)} aria-pressed={value === f.k}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${value === f.k ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{f.l}</button>
        ))}
        {action && <div className="hidden flex-1 md:block" />}
        {action && <button className={`hidden md:block ${action.className}`} onClick={action.onClick}>{action.label}</button>}
      </div>
      {action && <Fab label={action.label.replace(/^＋\s*/, '')} onClick={action.onClick} />}
    </>
  );
}
