import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { JumpWatch, resetJumpWatch } from '@/lib/editor-jump-watch';
import type { JumpReport } from '@/lib/editor-jump';

// The recorder of the caret jumping to the start (lib/editor-jump-watch.ts), on a real editor.
const TEXT = 'お世話になっております。本日の打ち合わせの件です。';

let editors: Editor[] = [];
function make(send: (r: JumpReport) => void) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({ element: el, extensions: [StarterKit, JumpWatch.configure({ shared: false, send })], content: `<p>${TEXT}</p><p>${TEXT}</p>` });
  editors.push(editor);
  return editor;
}
const key = (editor: Editor, k: string, init: KeyboardEventInit = {}) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const caretTo = (editor: Editor, pos: number) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
const typeAt = (editor: Editor, text: string) => editor.view.dispatch(editor.state.tr.insertText(text));

beforeEach(() => { vi.useFakeTimers(); resetJumpWatch(); });
afterEach(() => { editors.forEach(e => e.destroy()); editors = []; vi.useRealTimers(); });

describe('JumpWatch', () => {
  it('打っている途中に先頭へ飛ぶと、1.5秒後に1回だけ報告し、打った文字は入っていない', () => {
    const send = vi.fn();
    const editor = make(send);
    caretTo(editor, editor.state.doc.content.size - 1);
    key(editor, 'k');
    typeAt(editor, 'かきくけこ');
    key(editor, ' ');
    caretTo(editor, 1); // the jump
    expect(send).not.toHaveBeenCalled(); // waits to see what comes after
    key(editor, 'Enter');
    vi.advanceTimersByTime(1500);
    expect(send).toHaveBeenCalledTimes(1);
    const r: JumpReport = send.mock.calls[0][0];
    expect(r.jump).toMatchObject({ to: 1, start: 1, docChanged: false });
    expect(r.jump.tags).not.toContain('range');
    expect(r.jump.from).toBeGreaterThan(40);
    expect(r.jump.tags).toContain('typing');
    expect(r.jump.tags).not.toContain('nav');
    const kinds = r.events.map(e => `${e[1]}:${e[2]}`);
    expect(kinds).toEqual(expect.arrayContaining(['kd:char', 'kd:Space', 'jump:', 'kd:Enter']));
    const after = r.events.find(e => e[1] === 'kd' && e[2] === 'Enter')!;
    expect(after[0]).toBeGreaterThanOrEqual(0); // what came after the jump is in it too
    const json = JSON.stringify(r);
    expect(json).not.toContain('かきくけこ');
    expect(json).not.toContain('お世話');
  });

  it('矢印キーで先頭へ行ったときも報告はするが、nav の印が付く', () => {
    const send = vi.fn();
    const editor = make(send);
    caretTo(editor, 30);
    key(editor, 'ArrowUp', { metaKey: true });
    caretTo(editor, 1);
    vi.advanceTimersByTime(1500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].jump.tags).toContain('nav');
  });

  it('30秒のうちの2回目は送らない（ページで5回まで）', () => {
    const send = vi.fn();
    const editor = make(send);
    for (let i = 0; i < 8; i++) {
      caretTo(editor, 30);
      caretTo(editor, 1);
      vi.advanceTimersByTime(1500);
      if (i === 0) { // a second jump within 30 s
        caretTo(editor, 30);
        caretTo(editor, 1);
        vi.advanceTimersByTime(1500);
      }
      expect(send).toHaveBeenCalledTimes(Math.min(i + 1, 5));
      vi.advanceTimersByTime(30_000);
    }
  });

  it('1行目で少し戻るだけ（IME の変換）や、選んだ範囲の打ち替えは報告しない', () => {
    const send = vi.fn();
    const editor = make(send);
    caretTo(editor, 12);
    caretTo(editor, 9);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 40)));
    typeAt(editor, 'あ');
    vi.advanceTimersByTime(5000);
    expect(send).not.toHaveBeenCalled();
  });

  it('変換中の文節が範囲で選ばれていたところから先頭へ飛んでも報告し、range の印が付く', () => {
    const send = vi.fn();
    const editor = make(send);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 40, 43)));
    caretTo(editor, 1);
    vi.advanceTimersByTime(1500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].jump).toMatchObject({ from: 40, to: 1 });
    expect(send.mock.calls[0][0].jump.tags).toContain('range');
  });

  it('報告を待っている間に閉じられたら、その場で送る', () => {
    const send = vi.fn();
    const editor = make(send);
    caretTo(editor, 30);
    caretTo(editor, 1);
    editor.destroy();
    editors = editors.filter(e => e !== editor);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].events.map((e: unknown[]) => e[1])).toContain('de');
  });
});
