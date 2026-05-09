'use client';
import { useState, useRef, KeyboardEvent, ClipboardEvent } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  chips: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
}

export default function EmailChipInput({ chips, onChange, placeholder }: Props) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function confirm(raw: string) {
    const value = raw.trim().replace(/[,;]$/, '').trim();
    if (value && !chips.includes(value)) onChange([...chips, value]);
    setInput('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ' ') {
      if (input.trim()) { e.preventDefault(); confirm(input); }
    } else if (e.key === 'Backspace' && !input && chips.length > 0) {
      onChange(chips.slice(0, -1));
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    const parsed = text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (parsed.length > 1 || (parsed.length === 1 && EMAIL_RE.test(parsed[0]))) {
      e.preventDefault();
      const next = [...chips];
      for (const v of parsed) if (v && !next.includes(v)) next.push(v);
      onChange(next);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1 cursor-text min-h-[24px]"
      onClick={() => inputRef.current?.focus()}
    >
      {chips.map((chip, i) => {
        const valid = EMAIL_RE.test(chip);
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium border ${
              valid
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {chip}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onChange(chips.filter((_, j) => j !== i)); }}
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-50 hover:opacity-100 hover:bg-black/10 transition-opacity leading-none"
            >
              ×
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => { if (input.trim()) confirm(input); }}
        placeholder={chips.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[140px] bg-transparent border-0 outline-none text-xs text-gray-700 placeholder-gray-400 py-0.5"
      />
    </div>
  );
}
