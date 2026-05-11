'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import { Extension } from '@tiptap/core';
import { yCursorPlugin } from '@tiptap/y-tiptap';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { forwardRef, useImperativeHandle, useEffect, useMemo } from 'react';
import { ySyncPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { CollabUser } from '@/hooks/useCollab';

export type CollabEditorHandle = {
  getHTML: () => string;
  getText: () => string;
  focus: () => void;
  setHTML: (html: string) => void;
  isEmpty: () => boolean;
};

type Props = {
  doc: Y.Doc;
  awareness: Awareness;
  me: CollabUser;
  activeUsers: CollabUser[];
  placeholder?: string;
  minHeight?: number;
  onUpdate?: () => void;
  onLocalUpdate?: () => void;
  initialHTML?: string;
};

const PALETTE_COLORS = [
  '#000000', '#374151', '#6b7280', '#9ca3af',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
];

const ToolBtn = ({
  onClick, title, active, children,
}: {
  onClick: () => void; title: string; active?: boolean; children: React.ReactNode;
}) => (
  <button
    type="button"
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    title={title}
    className={`px-2 py-1 rounded text-sm transition-colors select-none ${
      active ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
    }`}
  >
    {children}
  </button>
);

function customCursorBuilder(user: { name?: string; color?: string }) {
  const color = user.color || '#3b82f6';
  const name = user.name || '?';
  const cursor = document.createElement('span');
  cursor.style.cssText = `position:relative;border-left:2px solid ${color};margin-left:-1px;margin-right:-1px;pointer-events:none;`;
  const label = document.createElement('div');
  label.textContent = name;
  label.style.cssText = `position:absolute;bottom:calc(100% + 1px);left:-1px;background:${color};color:white;font-size:10px;font-weight:600;padding:1px 6px 2px;border-radius:6px 6px 6px 0;white-space:nowrap;line-height:1.6;pointer-events:none;user-select:none;font-family:sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.2);`;
  cursor.appendChild(label);
  return cursor;
}

function makeCollabCursorExtension(awareness: Awareness) {
  return Extension.create({
    name: 'collabCursor',
    addProseMirrorPlugins() {
      return [yCursorPlugin(awareness, { cursorBuilder: customCursorBuilder })];
    },
  });
}

const CollabEditor = forwardRef<CollabEditorHandle, Props>(
  ({ doc, awareness, me, activeUsers, placeholder, minHeight = 160, onUpdate, onLocalUpdate, initialHTML }, ref) => {
    const collabCursorExtension = useMemo(
      () => makeCollabCursorExtension(awareness),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const editor = useEditor({
      immediatelyRender: false,
      onCreate({ editor }) {
        // If the Yjs doc is empty (new session) and we have prior content, inject it
        if (initialHTML && editor.isEmpty) {
          editor.commands.setContent(initialHTML);
        }
      },
      extensions: [
        // StarterKit v3 includes Link and Underline — disable to avoid duplicates
        StarterKit.configure({ history: false, link: false, underline: false } as any),
        TextStyle,
        Color,
        Collaboration.configure({ document: doc, field: 'body' }),
        collabCursorExtension,
      ],
      editorProps: {
        attributes: {
          class: 'p-3 text-sm focus:outline-none leading-relaxed',
          style: `min-height:${minHeight}px;color:#111827`,
          'data-placeholder': placeholder ?? '',
        },
      },
      onUpdate: ({ transaction }) => {
        onUpdate?.();
        // isChangeOrigin: true means this update came from a remote Yjs peer — skip draft save
        if (!transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) onLocalUpdate?.();
      },
    });

    useImperativeHandle(ref, () => ({
      getHTML: () => editor?.getHTML() ?? '',
      getText: () => editor?.getText() ?? '',
      focus: () => editor?.commands.focus(),
      setHTML: (html) => editor?.commands.setContent(html),
      isEmpty: () => editor?.isEmpty ?? true,
    }));

    useEffect(() => () => { editor?.destroy(); }, [editor]);

    if (!editor) return null;

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
        {/* Active users bar */}
        {activeUsers.length > 1 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 bg-gray-50 flex-wrap">
            <span className="text-xs text-gray-400 mr-1">編集中:</span>
            {activeUsers.map(u => (
              <span
                key={u.userId}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full text-white font-medium"
                style={{ backgroundColor: u.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white opacity-80 animate-pulse" />
                {u.name}{u.userId === me.userId ? ' (あなた)' : ''}
              </span>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap">
          <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} title="太字 (Ctrl+B)" active={editor.isActive('bold')}>
            <strong>B</strong>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体 (Ctrl+I)" active={editor.isActive('italic')}>
            <em>I</em>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleUnderline?.().run()} title="下線 (Ctrl+U)" active={editor.isActive('underline')}>
            <span className="underline">U</span>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} title="取り消し線" active={editor.isActive('strike')}>
            <span className="line-through">S</span>
          </ToolBtn>

          <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

          {/* Text color */}
          <div className="relative group">
            <button
              type="button"
              className="flex items-center gap-0.5 px-2 py-1 rounded text-sm text-gray-600 hover:bg-gray-200 select-none"
              title="文字色"
            >
              <span className="font-bold leading-none" style={{ borderBottom: '3px solid #ef4444' }}>A</span>
              <svg className="w-2 h-2 ml-0.5" viewBox="0 0 8 6" fill="currentColor"><path d="M4 6L0 0h8z"/></svg>
            </button>
            <div className="hidden group-hover:block absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-44">
              <div className="grid grid-cols-4 gap-1.5">
                {PALETTE_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c).run(); }}
                    className="w-7 h-7 rounded-md border border-gray-200 hover:scale-110 transition-transform cursor-pointer"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

          <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} title="箇条書き" active={editor.isActive('bulletList')}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="2.5" cy="4.5" r="1"/><path d="M5 4h9v1H5zm-2.5 4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm2.5.5h9v1H5zm-2.5 3.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm2.5.5h9v1H5z"/>
            </svg>
          </ToolBtn>

          <ToolBtn
            onClick={() => {
              const url = prompt('URLを入力してください:', 'https://');
              if (url) editor.chain().focus().setLink?.({ href: url }).run();
            }}
            title="リンクを挿入"
            active={editor.isActive('link')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1"/>
              <path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1"/>
            </svg>
          </ToolBtn>

          <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用を挿入" active={editor.isActive('blockquote')}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.5 5C2.67 5 2 5.67 2 6.5v2C2 9.33 2.67 10 3.5 10H5v.5c0 .83-.67 1.5-1.5 1.5H3v1.5h.5c1.66 0 3-1.34 3-3V6.5C6.5 5.67 5.83 5 5 5H3.5zm7 0C9.67 5 9 5.67 9 6.5v2c0 .83.67 1.5 1.5 1.5H12v.5c0 .83-.67 1.5-1.5 1.5H10v1.5h.5c1.66 0 3-1.34 3-3V6.5c0-.83-.67-1.5-1.5-1.5h-1.5z"/>
            </svg>
          </ToolBtn>

          <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

          <ToolBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="書式をクリア">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.27 1L2 2.27l5.11 5.11L4 13h2.5l1.64-3.89L13.73 15 15 13.73 3.27 1zm1.15 2.38L12 11l-1.5 2H8l1.5-3.5-5.08-4.12z"/>
            </svg>
          </ToolBtn>
        </div>

        <EditorContent editor={editor} />
      </div>
    );
  },
);

CollabEditor.displayName = 'CollabEditor';
export default CollabEditor;
