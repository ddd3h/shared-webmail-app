'use client';
import type { ReactNode } from 'react';

// Big, thumb-sized rows for picking one thing out of a few (shown inside a sheet). The chosen row has a check.
export type Choice = { value: string; label: ReactNode; hint?: string };

export default function ChoiceList({ choices, value, onPick }: { choices: Choice[]; value?: string; onPick: (value: string) => void }) {
  return (
    <ul className="-mx-1 divide-y divide-gray-100" role="listbox">
      {choices.map(c => (
        <li key={c.value} role="option" aria-selected={c.value === value}>
          <button onClick={() => onPick(c.value)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3.5 text-left active:bg-gray-100">
            <span className="min-w-0 flex-1">
              <span className="block text-base text-gray-900">{c.label}</span>
              {c.hint && <span className="block text-xs text-gray-500">{c.hint}</span>}
            </span>
            {c.value === value && <span aria-hidden className="text-blue-600">✓</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
