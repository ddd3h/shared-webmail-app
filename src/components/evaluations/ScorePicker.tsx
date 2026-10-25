'use client';
import { MAX_SCORE, MIN_SCORE } from '@/lib/org';

const POINTS = Array.from({ length: MAX_SCORE - MIN_SCORE + 1 }, (_, i) => MIN_SCORE + i);

// 1〜5 点を選ぶボタン。value=null は未入力。readOnly のときは点数だけ表示する。
export default function ScorePicker({ label, value, onChange, readOnly }: { label: string; value: number | null; onChange?: (v: number) => void; readOnly?: boolean }) {
  if (readOnly) return <span className="text-sm font-semibold tabular-nums">{value ?? '–'}<span className="text-xs font-normal text-gray-400"> / {MAX_SCORE}</span></span>;
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {POINTS.map(n => (
        <button
          key={n} type="button" aria-label={`${label} ${n}点`} aria-pressed={value === n} onClick={() => onChange?.(n)}
          className={`h-9 w-9 rounded-lg border text-sm font-medium transition-colors ${value === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
        >{n}</button>
      ))}
    </div>
  );
}
