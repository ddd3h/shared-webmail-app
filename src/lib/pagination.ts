// Paging for lists in the admin screens: which rows to read, and which page buttons (1 2 3 … 9) to show.

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

function positiveInt(raw: string | null | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/** Page and size from a query string. A bad value falls back to page 1 / the default size; the size has an upper limit. */
export function parsePaging(params: URLSearchParams): { page: number; pageSize: number } {
  return {
    page: positiveInt(params.get('page'), 1),
    pageSize: Math.min(positiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
  };
}

/**
 * Where to read for `page`. A page past the end (for example after the last row of the last page was deleted)
 * is moved back to the last page, so the screen never shows an empty page while rows exist.
 */
export function pageWindow(page: number, total: number, pageSize: number): { page: number; pages: number; skip: number; take: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { page: current, pages, skip: (current - 1) * pageSize, take: pageSize };
}

/** Page buttons: always the first and last page, and two pages around the current one; a gap is shown as '…'. */
export function pageNumbers(current: number, pages: number): (number | '…')[] {
  const show = new Set<number>([1, pages]);
  for (let p = current - 2; p <= current + 2; p++) if (p >= 1 && p <= pages) show.add(p);
  const sorted = [...show].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1); // a gap of one page: show the number, not '…'
    else if (prev !== undefined && p - prev > 2) out.push('…');
    out.push(p);
  });
  return out;
}
