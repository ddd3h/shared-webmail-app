'use client';
import { forwardRef, useImperativeHandle, useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Extension } from '@tiptap/core';
import DOMPurify from 'dompurify';
import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'b', 'blockquote', 'br', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
    'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
    'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strong',
    'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'wbr',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'target', 'rel', 'style', 'width', 'height',
    'colspan', 'rowspan', 'align', 'valign', 'border', 'cellpadding', 'cellspacing',
    'start', 'type', 'span', 'datetime',
  ],
  ALLOW_DATA_ATTR: false,
  FORCE_BODY: true,
};

function purify(html: string): string {
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
}

// Custom FontSize extension using TextStyle marks
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => el.style.fontSize || null,
          renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export type RichEditorHandle = {
  getHTML: () => string;
  getText: () => string;
  focus: () => void;
  setHTML: (html: string) => void;
  isEmpty: () => boolean;
};

export type CollabUser = { clientId: number; name: string; color: string; id?: string };

type Props = {
  placeholder?: string;
  minHeight?: number;
  initialHTML?: string;
  onInput?: () => void;
  ydoc?: Y.Doc;
  provider?: WebsocketProvider;
  currentUser?: { name: string; color: string; id?: string };
  onCollaboratorsChange?: (users: CollabUser[]) => void;
};

const PALETTE_COLORS = [
  '#000000', '#374151', '#6b7280', '#9ca3af', '#ffffff',
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#a16207',
];

const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72, 96, 144, 288];

const RichEditor = forwardRef<RichEditorHandle, Props>(
  ({ placeholder, minHeight = 160, initialHTML, onInput, ydoc, provider, currentUser, onCollaboratorsChange }, ref) => {
    const extensions = [
      // StarterKit v3 already bundles link & underline — configure them here
      // instead of adding separate extensions (which caused duplicate-name warnings).
      StarterKit.configure({
        undoRedo: ydoc ? false : undefined,
        link: { openOnClick: false },
      }),
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image,
      ...(ydoc
        ? [
            Collaboration.configure({ document: ydoc }),
            ...(provider && currentUser
              ? [CollaborationCaret.configure({ provider, user: currentUser })]
              : []),
          ]
        : []),
    ];

    const editor = useEditor({
      extensions,
      immediatelyRender: false, // client-only (dynamic ssr:false) — avoids hydration warning
      content: ydoc ? undefined : (initialHTML ? purify(initialHTML) : ''),
      onUpdate: () => onInput?.(),
      editorProps: {
        attributes: {
          class: 'prose prose-sm max-w-none focus:outline-none leading-relaxed',
          style: `min-height: ${minHeight}px; color: #111827; padding: 12px;`,
          'data-placeholder': placeholder ?? '',
        },
        handlePaste(_, event) {
          const items = Array.from(event.clipboardData?.items ?? []);
          const imgItem = items.find(i => i.type.startsWith('image/'));
          if (imgItem) {
            event.preventDefault();
            const file = imgItem.getAsFile();
            if (!file) return true;
            const reader = new FileReader();
            reader.onload = () => {
              editor?.chain().focus().setImage({ src: reader.result as string }).run();
              onInput?.();
            };
            reader.readAsDataURL(file);
            return true;
          }
          if (event.clipboardData?.types.includes('text/html')) {
            event.preventDefault();
            const raw = event.clipboardData.getData('text/html');
            editor?.chain().focus().insertContent(purify(raw)).run();
            setTimeout(() => onInput?.(), 0);
            return true;
          }
          return false;
        },
      },
    }, [ydoc, provider]); // re-create editor once Yjs doc/provider become available

    useEffect(() => {
      if (!ydoc && editor && initialHTML && !editor.isEmpty) return;
      if (!ydoc && editor && initialHTML) {
        editor.commands.setContent(purify(initialHTML));
      }
    }, [initialHTML]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep the collaboration cursor label in sync when the display name resolves
    // after the editor (and its awareness state) was already created.
    useEffect(() => {
      if (provider && currentUser) {
        provider.awareness.setLocalStateField('user', currentUser);
      }
    }, [provider, currentUser]);

    // Report the set of connected collaborators (from awareness) to the parent
    // so it can render presence avatars.
    useEffect(() => {
      if (!provider || !onCollaboratorsChange) return;
      const aw = provider.awareness;
      const update = () => {
        const seen = new Set<string>();
        const users: CollabUser[] = [];
        aw.getStates().forEach((state, clientId) => {
          const u = (state as { user?: { name?: string; color?: string; id?: string } }).user;
          if (!u) return;
          // de-dupe by user id (same person in multiple tabs) when id is present
          const key = u.id ?? `c${clientId}`;
          if (seen.has(key)) return;
          seen.add(key);
          users.push({ clientId, name: u.name ?? 'ユーザー', color: u.color ?? '#888', id: u.id });
        });
        onCollaboratorsChange(users);
      };
      update();
      aw.on('change', update);
      return () => aw.off('change', update);
    }, [provider, onCollaboratorsChange]);

    useImperativeHandle(ref, () => ({
      getHTML: () => editor?.getHTML() ?? '',
      getText: () => editor?.getText() ?? '',
      focus: () => { editor?.commands.focus(); },
      setHTML: (html: string) => { editor?.commands.setContent(purify(html)); },
      isEmpty: () => editor?.isEmpty ?? true,
    }), [editor]);

    if (!editor) return null;

    const ToolBtn = ({
      onClick, title, children, active,
    }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) => (
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

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap">
          <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} title="太字 (Ctrl+B)" active={editor.isActive('bold')}>
            <strong>B</strong>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体 (Ctrl+I)" active={editor.isActive('italic')}>
            <em>I</em>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} title="下線 (Ctrl+U)" active={editor.isActive('underline')}>
            <span className="underline">U</span>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} title="取り消し線" active={editor.isActive('strike')}>
            <span className="line-through">S</span>
          </ToolBtn>

          <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

          {/* Font size */}
          <select
            defaultValue="12"
            onChange={(e) => {
              editor.chain().focus().setFontSize(`${e.target.value}pt`).run();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-600 cursor-pointer hover:border-gray-300 focus:outline-none focus:border-blue-400"
            title="フォントサイズ (pt)"
          >
            {FONT_SIZES.map(pt => <option key={pt} value={pt}>{pt}pt</option>)}
          </select>

          {/* Text color */}
          <div className="relative group">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              title="文字色"
              className="flex items-center gap-0.5 px-2 py-1 rounded text-sm text-gray-600 hover:bg-gray-200 select-none"
            >
              <span className="font-bold leading-none" style={{ borderBottom: '3px solid #ef4444' }}>A</span>
              <svg className="w-2 h-2 ml-0.5" viewBox="0 0 8 6" fill="currentColor"><path d="M4 6L0 0h8z" /></svg>
            </button>
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-48 hidden group-hover:block">
              <p className="text-xs text-gray-400 mb-2 font-medium">文字色</p>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {PALETTE_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editor.chain().focus().setColor(c).run();
                      onInput?.();
                    }}
                    title={c}
                    className="w-7 h-7 rounded-md border border-gray-200 hover:scale-110 transition-transform cursor-pointer"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">カスタム</p>
                <input
                  type="color"
                  className="w-full h-7 rounded cursor-pointer border border-gray-200"
                  defaultValue="#000000"
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => { editor.chain().focus().setColor(e.target.value).run(); onInput?.(); }}
                />
              </div>
            </div>
          </div>

          <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} title="左揃え" active={editor.isActive({ textAlign: 'left' })}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12v1.5H2zm0 3h8v1.5H2zm0 3h12v1.5H2zm0 3h8v1.5H2z" /></svg>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} title="中央揃え" active={editor.isActive({ textAlign: 'center' })}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12v1.5H2zm2 3h8v1.5H4zm-2 3h12v1.5H2zm2 3h8v1.5H4z" /></svg>
          </ToolBtn>

          <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

          <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用を挿入" active={editor.isActive('blockquote')}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 5C2.67 5 2 5.67 2 6.5v2C2 9.33 2.67 10 3.5 10H5v.5c0 .83-.67 1.5-1.5 1.5H3v1.5h.5c1.66 0 3-1.34 3-3V6.5C6.5 5.67 5.83 5 5 5H3.5zm7 0C9.67 5 9 5.67 9 6.5v2c0 .83.67 1.5 1.5 1.5H12v.5c0 .83-.67 1.5-1.5 1.5H10v1.5h.5c1.66 0 3-1.34 3-3V6.5c0-.83-.67-1.5-1.5-1.5h-1.5z" /></svg>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} title="箇条書き" active={editor.isActive('bulletList')}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><circle cx="2.5" cy="4.5" r="1" /><path d="M5 4h9v1H5zm-2.5 4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm2.5.5h9v1H5zm-2.5 3.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm2.5.5h9v1H5z" /></svg>
          </ToolBtn>
          <ToolBtn
            onClick={() => {
              const url = prompt('URLを入力してください:', 'https://');
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }}
            title="リンクを挿入"
            active={editor.isActive('link')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" /><path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" /></svg>
          </ToolBtn>

          <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />

          <ToolBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="書式をクリア">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M3.27 1L2 2.27l5.11 5.11L4 13h2.5l1.64-3.89L13.73 15 15 13.73 3.27 1zm1.15 2.38L12 11l-1.5 2H8l1.5-3.5-5.08-4.12z" /></svg>
          </ToolBtn>

          {/* Collaboration cursors legend */}
          {provider && (
            <div className="ml-auto flex items-center gap-1">
              {/* y-webrtc awareness renders cursors inside EditorContent automatically */}
            </div>
          )}
        </div>

        {/* Editor area */}
        <EditorContent editor={editor} />
      </div>
    );
  },
);

RichEditor.displayName = 'RichEditor';
export default RichEditor;
