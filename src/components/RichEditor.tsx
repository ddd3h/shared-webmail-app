'use client';
import { useRef, forwardRef, useImperativeHandle, useEffect, useState } from 'react';

export type RichEditorHandle = {
  getHTML: () => string;
  getText: () => string;
  focus: () => void;
  setHTML: (html: string) => void;
  isEmpty: () => boolean;
};

type Props = {
  placeholder?: string;
  minHeight?: number;
  initialHTML?: string;
  onInput?: () => void;
};

const PALETTE_COLORS = [
  '#000000', '#374151', '#6b7280', '#9ca3af', '#ffffff',
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#a16207',
];

const RichEditor = forwardRef<RichEditorHandle, Props>(({ placeholder, minHeight = 160, initialHTML, onInput }, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [fontSizeInput, setFontSizeInput] = useState('12');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const nativeColorRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    getHTML: () => editorRef.current?.innerHTML ?? '',
    getText: () => editorRef.current?.innerText ?? '',
    focus: () => editorRef.current?.focus(),
    setHTML: (html: string) => { if (editorRef.current) editorRef.current.innerHTML = html; },
    isEmpty: () => !editorRef.current?.innerText?.trim()
  }));

  useEffect(() => {
    if (initialHTML && editorRef.current) {
      editorRef.current.innerHTML = initialHTML;
    }
  }, [initialHTML]);

  // Close color picker when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    }
    if (showColorPicker) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColorPicker]);

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val ?? undefined);
  };

  const applyFontSize = (pt: number) => {
    if (!pt || pt < 1) return;
    editorRef.current?.focus();
    document.execCommand('fontSize', false, '7');
    const editor = editorRef.current;
    if (editor) {
      editor.querySelectorAll('font[size="7"]').forEach(font => {
        const span = document.createElement('span');
        span.style.fontSize = `${pt}pt`;
        span.innerHTML = (font as HTMLElement).innerHTML;
        font.parentNode?.replaceChild(span, font);
      });
    }
  };

  const applyColor = (color: string) => {
    editorRef.current?.focus();
    document.execCommand('foreColor', false, color);
    setShowColorPicker(false);
    onInput?.();
  };

  const insertQuote = () => {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false,
      '<blockquote style="border-left:3px solid #d1d5db;margin:8px 0;padding:4px 12px;color:#6b7280;font-style:italic"></blockquote><br>'
    );
  };

  const insertLink = () => {
    const url = prompt('URLを入力してください:', 'https://');
    if (url) exec('createLink', url);
  };

  const ToolBtn = ({ onClick, title, children, active }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`px-2 py-1 rounded text-sm transition-colors select-none ${active ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'}`}
    >
      {children}
    </button>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap">
        <ToolBtn onClick={() => exec('bold')} title="太字 (Ctrl+B)"><strong>B</strong></ToolBtn>
        <ToolBtn onClick={() => exec('italic')} title="斜体 (Ctrl+I)"><em>I</em></ToolBtn>
        <ToolBtn onClick={() => exec('underline')} title="下線 (Ctrl+U)"><span className="underline">U</span></ToolBtn>
        <ToolBtn onClick={() => exec('strikeThrough')} title="取り消し線"><span className="line-through">S</span></ToolBtn>

        <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

        {/* Font size */}
        <select
          value={fontSizeInput}
          onChange={(e) => { setFontSizeInput(e.target.value); applyFontSize(parseInt(e.target.value)); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-600 cursor-pointer hover:border-gray-300 focus:outline-none focus:border-blue-400"
          title="フォントサイズ (pt)"
        >
          {[9,10,11,12,14,16,18,20,24,28,32,36,48,72,96,144,288].map(pt => (
            <option key={pt} value={pt}>{pt}pt</option>
          ))}
        </select>

        {/* Text color */}
        <div ref={colorPickerRef} className="relative">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setShowColorPicker(v => !v); }}
            title="文字色"
            className="flex items-center gap-0.5 px-2 py-1 rounded text-sm text-gray-600 hover:bg-gray-200 select-none"
          >
            <span className="font-bold leading-none" style={{ borderBottom: '3px solid #ef4444' }}>A</span>
            <svg className="w-2 h-2 ml-0.5" viewBox="0 0 8 6" fill="currentColor"><path d="M4 6L0 0h8z"/></svg>
          </button>
          {showColorPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-48">
              <p className="text-xs text-gray-400 mb-2 font-medium">文字色</p>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {PALETTE_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyColor(c); }}
                    title={c}
                    className="w-7 h-7 rounded-md border border-gray-200 hover:scale-110 transition-transform cursor-pointer"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">カスタム</p>
                <input
                  ref={nativeColorRef}
                  type="color"
                  className="w-full h-7 rounded cursor-pointer border border-gray-200"
                  defaultValue="#000000"
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => { exec('foreColor', e.target.value); onInput?.(); }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

        <ToolBtn onClick={() => exec('justifyLeft')} title="左揃え">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12v1.5H2zm0 3h8v1.5H2zm0 3h12v1.5H2zm0 3h8v1.5H2z"/></svg>
        </ToolBtn>
        <ToolBtn onClick={() => exec('justifyCenter')} title="中央揃え">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12v1.5H2zm2 3h8v1.5H4zm-2 3h12v1.5H2zm2 3h8v1.5H4z"/></svg>
        </ToolBtn>

        <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

        <ToolBtn onClick={insertQuote} title="引用を挿入">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 5C2.67 5 2 5.67 2 6.5v2C2 9.33 2.67 10 3.5 10H5v.5c0 .83-.67 1.5-1.5 1.5H3v1.5h.5c1.66 0 3-1.34 3-3V6.5C6.5 5.67 5.83 5 5 5H3.5zm7 0C9.67 5 9 5.67 9 6.5v2c0 .83.67 1.5 1.5 1.5H12v.5c0 .83-.67 1.5-1.5 1.5H10v1.5h.5c1.66 0 3-1.34 3-3V6.5c0-.83-.67-1.5-1.5-1.5h-1.5z"/></svg>
        </ToolBtn>

        <ToolBtn onClick={() => exec('insertUnorderedList')} title="箇条書き">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><circle cx="2.5" cy="4.5" r="1"/><path d="M5 4h9v1H5zm-2.5 4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm2.5.5h9v1H5zm-2.5 3.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm2.5.5h9v1H5z"/></svg>
        </ToolBtn>

        <ToolBtn onClick={insertLink} title="リンクを挿入">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1"/><path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1"/></svg>
        </ToolBtn>

        <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

        <ToolBtn onClick={() => exec('removeFormat')} title="書式をクリア">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M3.27 1L2 2.27l5.11 5.11L4 13h2.5l1.64-3.89L13.73 15 15 13.73 3.27 1zm1.15 2.38L12 11l-1.5 2H8l1.5-3.5-5.08-4.12z"/></svg>
        </ToolBtn>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="p-3 text-sm focus:outline-none leading-relaxed"
        style={{ minHeight: `${minHeight}px`, color: '#111827' }}
        onInput={onInput}
        onPaste={(e) => {
          const items = Array.from(e.clipboardData.items);

          // Handle image paste (screenshots, copied images)
          const imageItem = items.find(item => item.type.startsWith('image/'));
          if (imageItem) {
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = () => {
                document.execCommand('insertHTML', false, `<img src="${reader.result}" style="max-width:100%;height:auto">`);
                onInput?.();
              };
              reader.readAsDataURL(file);
            }
            return;
          }

          // Allow HTML paste natively (preserves styles from other apps)
          // Let the browser handle it, just trigger onInput after
          setTimeout(() => onInput?.(), 0);
        }}
        data-placeholder={placeholder}
      />
    </div>
  );
});

RichEditor.displayName = 'RichEditor';
export default RichEditor;
