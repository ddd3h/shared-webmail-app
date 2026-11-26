// A report of the caret jumping to the start of the mail body while somebody types (the "cursor goes to the first line" problem,
// seen with fast IME typing on Mac Chrome, never reproduced here). The editor sends one to /api/diag/editor-jump when it happens
// (see lib/editor-jump-watch.ts) and the server writes it to its log, so the cause can be read from the order of events.
//
// Nothing typed is ever recorded: only the names of a few keys (Space, Enter, arrows...), shortcut letters pressed with Cmd/Ctrl,
// event kinds, input types (insertCompositionText...), lengths, positions and times. The server checks this again (isSafeDetail).

/** kd keydown · cs/cu/ce composition start/update/end · bi beforeinput · md mousedown · ts touchstart · fo/bl focus/blur ·
 *  sc the page's selection moved (position in the doc) · tr a transaction (old and new caret) · cr/de editor made/destroyed · jump the jump itself */
export const JUMP_EVENT_KINDS = ['kd', 'cs', 'cu', 'ce', 'bi', 'md', 'ts', 'fo', 'bl', 'sc', 'tr', 'cr', 'de', 'jump'] as const;
export type JumpEventKind = (typeof JUMP_EVENT_KINDS)[number];
/** [ms from the jump, kind, detail, a, b, which editor on the page] */
export type JumpEvent = [number, JumpEventKind, string, number, number, number];

export const JUMP_TAGS = ['typing', 'nav', 'pointer', 'remote', 'undo', 'range'] as const;
export type JumpTag = (typeof JUMP_TAGS)[number];

export type JumpReport = {
  v: 1;
  shared: boolean;
  path: string;
  jump: { from: number; to: number; start: number; size: number; docChanged: boolean; metas: string[]; composing: boolean; focused: boolean; tags: JumpTag[] };
  events: JumpEvent[];
};

// Keys whose name says nothing about the text: they are recorded by name. Every other key is "char".
const NAMED_KEYS = new Set([
  'Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'Process', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified', 'Lang1', 'Lang2', 'KanaMode', 'Eisu', 'Convert',
  'NonConvert', 'Hiragana', 'Katakana', 'HiraganaKatakana', 'Zenkaku', 'Hankaku', 'ZenkakuHankaku', 'Alphanumeric',
]);
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

type KeyLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };

/** "Space", "Enter", "M+z" (Cmd+Z), "S+char"... never the character typed (and never `code`: during IME it is the romaji). */
export function keyLabel(e: KeyLike): string {
  const mods = (e.metaKey ? 'M' : '') + (e.ctrlKey ? 'C' : '') + (e.altKey ? 'A' : '') + (e.shiftKey ? 'S' : '');
  let name: string;
  if (e.key === ' ') name = 'Space';
  else if (NAMED_KEYS.has(e.key)) name = e.key;
  else if ((e.metaKey || e.ctrlKey) && /^[a-zA-Z]$/.test(e.key)) name = e.key.toLowerCase(); // a shortcut (Cmd+Z, Ctrl+A), not text
  else name = 'char';
  return mods ? `${mods}+${name}` : name;
}

const LABEL = /^(?:([MCAS]{1,4})\+)?([A-Za-z0-9]{1,20})$/;
/** A key that moves the caret on purpose: an arrow, Home/End, Page Up/Down, or a Cmd/Ctrl shortcut (Ctrl+A goes to the line start on a Mac). */
export function isNavLabel(label: string): boolean {
  const m = LABEL.exec(label);
  if (!m) return false;
  const [, mods = '', name] = m;
  return NAV_KEYS.has(name) || (/[MC]/.test(mods) && /^[a-z]$/.test(name));
}

/** The details a report may carry, checked on the server so that a bug in the page cannot send typed text. */
export function isSafeDetail(kind: JumpEventKind, detail: string): boolean {
  switch (kind) {
    case 'kd': {
      const m = LABEL.exec(detail);
      if (!m) return false;
      const [, mods = '', name] = m;
      return name === 'Space' || name === 'char' || NAMED_KEYS.has(name) || (/^[a-z]$/.test(name) && /[MC]/.test(mods));
    }
    case 'bi': return /^[a-zA-Z]{0,40}$/.test(detail); // an inputType: insertText, insertCompositionText, deleteContentBackward...
    case 'tr': return /^[DS]{0,2}\|[A-Za-z0-9$_,-]{0,300}$/.test(detail); // D doc changed, S selection set | the names of the metas
    default: return detail === '';
  }
}

/** A meta name of a transaction (a plugin key such as "y-sync$", or "pointer", "composition"): code, never text. */
export const isMetaName = (s: string) => /^[A-Za-z0-9$_-]{1,40}$/.test(s);

/**
 * Did the caret jump (back) to the start of the doc? Measured from where the selection began before and after (`from`): during an IME
 * conversion the clause being converted may be a selected range, and typing over a range that began at the start is not a jump.
 * `start` is the first place a caret can be (1 for a doc that starts with a paragraph). Two shapes count: right at the start, having been
 * at least 3 places further on; or a few characters past the start, having been far further on (the jump, and what was typed there before
 * the next transaction). Converting a long phrase with the IME moves the caret back only a few places.
 */
export function isJumpToStart(p: { oldFrom: number; newFrom: number; start: number }): boolean {
  const back = p.oldFrom - p.newFrom;
  if (p.newFrom <= p.start + 1 && back >= 3) return true;
  return p.newFrom <= p.start + 12 && back >= 15;
}

/** The page the editor was on, with record ids taken out: "/threads/:id". */
export function pathPattern(path: string): string {
  return path.split('?')[0].split('/').map(seg => {
    if (seg === '') return seg;
    if (/^\d+$/.test(seg)) return ':n';
    if (/^[a-z][a-z-]{0,24}$/.test(seg)) return seg; // a word of the app (threads, compose, year-end); an id has digits
    return ':id';
  }).join('/').slice(0, 120);
}
