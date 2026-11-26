// Watches the mail editor for the caret jumping to the start of the body, and reports it with what came just before and after
// (see lib/editor-jump.ts for what a report holds and why no typed text is in it).
//
// It only looks: the plugin never changes a transaction or the selection, and handles no event (every handler returns false).
// Per keystroke it pushes a few small entries into a ring buffer; nothing is serialized until a jump is seen.
// At most one report per 30 seconds and five per page load, and a failed send is ignored.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { isJumpToStart, isMetaName, isNavLabel, keyLabel, pathPattern, type JumpEvent, type JumpEventKind, type JumpReport, type JumpTag } from '@/lib/editor-jump';

export const JUMP_REPORT_URL = '/api/diag/editor-jump';
const RING = 200;          // entries kept (a fast typist makes about 6 per keystroke)
const BEFORE_MS = 6000;    // what came before the jump that goes into the report
const AFTER_MS = 1500;     // the report waits this long, to show what came after (did the caret come back?)
const MAX_EVENTS = 300;
const GAP_MS = 30_000;
const PAGE_MAX = 5;

type Entry = { n: number; t: number; k: JumpEventKind; d: string; a: number; b: number; e: number };

// One buffer for the page: when the editor is rebuilt, the old one's last moments and the new one's first stay in one timeline.
const ring: Entry[] = [];
let sentOnPage = 0;
let lastSentAt = -Infinity;
let serial = 0;
let seq = 0; // the order of entries (two can share a millisecond)
const now = () => Date.now();

function push(k: JumpEventKind, editor: number, d = '', a = 0, b = 0) {
  ring.push({ n: ++seq, t: now(), k, d, a, b, e: editor });
  if (ring.length > RING) ring.splice(0, ring.length - RING);
}

/** For tests: forget everything (the buffer and the per-page limits). */
export function resetJumpWatch() {
  ring.length = 0;
  sentOnPage = 0;
  lastSentAt = -Infinity;
}

export function postJumpReport(report: JumpReport) {
  try {
    void fetch(JUMP_REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), keepalive: true }).catch(() => {});
  } catch { /* never let a report get in the way of typing */ }
}

function metaNames(tr: Transaction): string[] {
  const meta = (tr as unknown as { meta?: Record<string, unknown> }).meta ?? {};
  const names = Object.keys(meta).filter(isMetaName);
  if ((tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin) names.push('remote');
  return names.slice(0, 12);
}

function tagsFor(before: Entry[], jumpAt: number, metas: string[]): JumpTag[] {
  const within = (ms: number, kinds: JumpEventKind[]) => before.filter(x => jumpAt - x.t <= ms && kinds.includes(x.k));
  const tags: JumpTag[] = [];
  if (within(2000, ['kd', 'cs', 'cu', 'ce', 'bi']).length) tags.push('typing');
  if (within(800, ['kd']).some(x => isNavLabel(x.d))) tags.push('nav');
  if (within(800, ['md', 'ts']).length) tags.push('pointer');
  if (metas.includes('remote')) tags.push('remote');
  if (metas.includes('y-undo$') || within(800, ['kd']).some(x => /^[MC]+S?\+z$/.test(x.d)) || within(800, ['bi']).some(x => x.d.startsWith('history'))) tags.push('undo');
  return tags;
}

class Watcher {
  readonly id = ++serial;
  view: EditorView | null = null;
  private collecting: ReturnType<typeof setTimeout> | null = null;
  private flush: (() => void) | null = null;

  constructor(private shared: boolean, private send: (r: JumpReport) => void) {}

  onTransaction(tr: Transaction, before: EditorState, after: EditorState) {
    const oldHead = before.selection.head;
    const newHead = after.selection.head;
    if (!tr.docChanged && oldHead === newHead) return; // the many no-op transactions (carets of the others) are left out
    const metas = metaNames(tr);
    push('tr', this.id, `${tr.docChanged ? 'D' : ''}${tr.selectionSet ? 'S' : ''}|${metas.join(',')}`, oldHead, newHead);
    const start = Selection.atStart(after.doc).from;
    if (isJumpToStart({ oldHead, newHead, oldEmpty: before.selection.empty, start })) this.onJump({ oldHead, newHead, start, size: after.doc.content.size, docChanged: tr.docChanged, metas });
  }

  private onJump(j: { oldHead: number; newHead: number; start: number; size: number; docChanged: boolean; metas: string[] }) {
    const at = now();
    if (this.collecting || sentOnPage >= PAGE_MAX || at - lastSentAt < GAP_MS) return;
    sentOnPage++;
    lastSentAt = at;
    const mark = seq; // everything up to the jump's own transaction
    const before = ring.filter(x => at - x.t <= BEFORE_MS);
    const jump: JumpReport['jump'] = {
      from: j.oldHead, to: j.newHead, start: j.start, size: j.size, docChanged: j.docChanged, metas: j.metas,
      composing: !!this.view?.composing, focused: !!this.view?.hasFocus(), tags: tagsFor(before, at, j.metas),
    };
    this.flush = () => {
      this.collecting = null;
      this.flush = null;
      const after = ring.filter(x => x.n > mark && x.t - at <= AFTER_MS + 500);
      const row = (x: Entry): JumpEvent => [Math.round(x.t - at), x.k, x.d, x.a, x.b, x.e];
      const kept = after.slice(0, MAX_EVENTS / 2);
      const events: JumpEvent[] = [...before.slice(-(MAX_EVENTS - kept.length - 1)).map(row), [0, 'jump', '', j.oldHead, j.newHead, this.id], ...kept.map(row)];
      const path = typeof location !== 'undefined' ? pathPattern(location.pathname) : '';
      try { this.send({ v: 1, shared: this.shared, path, jump, events }); } catch { /* ignore */ }
    };
    this.collecting = setTimeout(() => this.flush?.(), AFTER_MS);
  }

  attach(view: EditorView) {
    this.view = view;
    push('cr', this.id);
    const onSelection = () => {
      const sel = view.dom.ownerDocument.getSelection();
      if (!sel?.focusNode || !view.dom.contains(sel.focusNode)) return;
      let pos = -1;
      try { pos = view.posAtDOM(sel.focusNode, sel.focusOffset); } catch { /* the DOM is mid-change */ }
      push('sc', this.id, '', pos, view.composing ? 1 : 0);
    };
    view.dom.ownerDocument.addEventListener('selectionchange', onSelection);
    return {
      destroy: () => {
        view.dom.ownerDocument.removeEventListener('selectionchange', onSelection);
        push('de', this.id);
        if (this.collecting) { clearTimeout(this.collecting); this.flush?.(); }
        this.view = null;
      },
    };
  }

  plugin() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const w = this;
    const note = (k: JumpEventKind, d = '', a = 0, b = 0) => { push(k, w.id, d, a, b); return false; };
    return new Plugin({
      key: new PluginKey(`jumpWatch${this.id}`),
      // Plugin state is the one place that sees every transaction with the state before and after it. Nothing is stored in it.
      state: {
        init: () => null,
        apply(tr, value, before, after) { try { w.onTransaction(tr, before, after); } catch { /* never in the way */ } return value; },
      },
      view: view => w.attach(view),
      props: {
        handleDOMEvents: {
          keydown: (_v, e) => note('kd', keyLabel(e), e.isComposing ? 1 : 0, e.keyCode === 229 ? 1 : 0),
          compositionstart: (_v, e) => note('cs', '', e.data?.length ?? 0),
          compositionupdate: (_v, e) => note('cu', '', e.data?.length ?? 0),
          compositionend: (_v, e) => note('ce', '', e.data?.length ?? 0),
          beforeinput: (_v, e) => note('bi', /^[a-zA-Z]{0,40}$/.test(e.inputType) ? e.inputType : '', e.data?.length ?? 0, e.isComposing ? 1 : 0),
          mousedown: () => note('md'),
          touchstart: () => note('ts'),
          focus: () => note('fo'),
          blur: () => note('bl'),
        },
      },
    });
  }
}

/** Add to the editor's extensions. `shared`: the shared-draft editor (Yjs). `send` is for tests. */
export const JumpWatch = Extension.create<{ shared: boolean; send?: (r: JumpReport) => void }>({
  name: 'jumpWatch',
  addOptions() { return { shared: false, send: undefined }; },
  addProseMirrorPlugins() {
    return [new Watcher(this.options.shared, this.options.send ?? postJumpReport).plugin()];
  },
});
