// Pure helpers for the calendar's day / week / month views (no I/O so they are easy to test).
// Dates here are the browser's local calendar days; an event is anything with a start and an end.

export type CalendarView = 'day' | 'week' | 'month';
export const VIEWS: { key: CalendarView; label: string }[] = [{ key: 'day', label: '日' }, { key: 'week', label: '週' }, { key: 'month', label: '月' }];
export const isView = (v: string | null | undefined): v is CalendarView => v === 'day' || v === 'week' || v === 'month';

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** The Sunday that starts the week of `d` (weeks run Sunday to Saturday, as in the month grid). */
export const startOfWeek = (d: Date) => addDays(d, -d.getDay());

/** The days a view shows: the whole 6-week grid for a month, 7 days for a week, one for a day. */
export function visibleDays(view: CalendarView, anchor: Date): Date[] {
  if (view === 'day') return [startOfDay(anchor)];
  if (view === 'week') { const s = startOfWeek(anchor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

/** Move one step: a day, a week or a month. A month step lands on the 1st (the grid only needs the month). */
export function shiftAnchor(view: CalendarView, anchor: Date, dir: -1 | 1): Date {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export const weekdayLabel = (d: Date) => WEEK[d.getDay()];

/** The heading between the arrows. */
export function viewTitle(view: CalendarView, anchor: Date): string {
  if (view === 'month') return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;
  if (view === 'day') return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月${anchor.getDate()}日（${weekdayLabel(anchor)}）`;
  const days = visibleDays('week', anchor), a = days[0], b = days[6];
  const end = a.getMonth() === b.getMonth() ? `${b.getDate()}日` : `${b.getMonth() + 1}月${b.getDate()}日`;
  return `${a.getFullYear()}年${a.getMonth() + 1}月${a.getDate()}日 – ${end}`;
}

// ---- a day as a column of hours --------------------------------------------------------------

export type Span = { id: string; start: Date; end: Date };
export type Placed<T extends Span> = { item: T; top: number; height: number; column: number; columns: number };

export const MINUTES_PER_DAY = 24 * 60;
const MIN_MINUTES = 20; // a very short event is still tall enough to click

/** The part of a span that falls on `day`, in minutes from midnight (null when it does not touch the day). */
export function minutesOnDay(span: Span, day: Date): { from: number; to: number } | null {
  const d0 = startOfDay(day).getTime(), d1 = addDays(day, 1).getTime();
  const s = span.start.getTime(), e = span.end.getTime();
  const instant = e <= s; // no length: it sits at its start time
  if (instant ? !(s >= d0 && s < d1) : !(s < d1 && e > d0)) return null;
  const from = Math.min((Math.max(s, d0) - d0) / 60000, MINUTES_PER_DAY - MIN_MINUTES);
  const to = instant ? from : (Math.min(e, d1) - d0) / 60000;
  return { from, to: Math.min(MINUTES_PER_DAY, Math.max(from + MIN_MINUTES, to)) };
}

/**
 * Put the timed events of one day side by side without covering each other: events that overlap share the width of
 * their group, each in its own column. `top` and `height` are minutes (multiply by the pixel height of a minute).
 */
export function layoutDay<T extends Span>(items: T[], day: Date): Placed<T>[] {
  const timed = items
    .map(item => ({ item, m: minutesOnDay(item, day) }))
    .filter((x): x is { item: T; m: { from: number; to: number } } => x.m !== null)
    .sort((a, b) => a.m.from - b.m.from || b.m.to - a.m.to);

  const out: Placed<T>[] = [];
  let group: { item: T; m: { from: number; to: number }; column: number }[] = [];
  let groupEnd = -1;
  const flush = () => {
    const columns = Math.max(1, ...group.map(g => g.column + 1));
    for (const g of group) out.push({ item: g.item, top: g.m.from, height: g.m.to - g.m.from, column: g.column, columns });
    group = []; groupEnd = -1;
  };
  for (const t of timed) {
    if (group.length > 0 && t.m.from >= groupEnd) flush();
    const taken = new Set(group.filter(g => g.m.to > t.m.from).map(g => g.column));
    let column = 0;
    while (taken.has(column)) column++;
    group.push({ ...t, column });
    groupEnd = Math.max(groupEnd, t.m.to);
  }
  flush();
  return out;
}
