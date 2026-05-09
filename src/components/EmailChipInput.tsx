'use client';
import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Suggestion = { name: string | null; email: string };

interface Props {
  chips: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
}

export default function EmailChipInput({ chips, onChange, placeholder }: Props) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = input.trim();
    if (!q) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const items: Suggestion[] = (data.contacts || [])
          .filter((c: any) => c.email)
          .map((c: any) => ({ name: c.name || null, email: c.email }));
        setSuggestions(items);
        setActiveIdx(-1);
        setOpen(items.length > 0);
      } catch {
        setSuggestions([]); setOpen(false);
      }
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [input]);

  function addChip(value: string) {
    const v = value.trim().replace(/[,;]$/, '').trim();
    if (v && !chips.includes(v)) onChange([...chips, v]);
    setInput('');
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  }

  function selectSuggestion(s: Suggestion) {
    addChip(s.email);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveIdx(-1);
        return;
      }
    }
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ' ') {
      if (input.trim()) { e.preventDefault(); addChip(input); }
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
    <div ref={containerRef} className="relative flex-1 min-w-0">
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
          onBlur={() => {
            // delay so click on suggestion fires first
            setTimeout(() => {
              setOpen(false);
              setActiveIdx(-1);
              if (input.trim()) addChip(input);
            }, 150);
          }}
          placeholder={chips.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[140px] bg-transparent border-0 outline-none text-xs text-gray-700 placeholder-gray-400 py-0.5"
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 top-full mt-1 z-50 w-full max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          {suggestions.map((s, i) => (
            <li key={s.email}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => selectSuggestion(s)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-baseline gap-2 transition-colors ${
                  i === activeIdx ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s.name && <span className="font-medium truncate">{s.name}</span>}
                <span className={`truncate ${s.name ? 'text-gray-400' : 'font-medium'}`}>{s.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
