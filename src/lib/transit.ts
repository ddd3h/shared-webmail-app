// Public transport (電車・バス) for 交通費 claims: links to the free route-search sites, and the shape of a route shown on screen.
// There is no free route-search API for trains in Japan, so the links open the search with the places and the day filled in;
// with a Google Maps key the route itself (and the fare, when Google knows it) is shown in the app (src/lib/transit-route.ts).

export type TransitQuery = { from: string; to: string; date: string; time?: string };

export type TransitStep = { kind: 'walk' | 'transit'; minutes: number; line?: string; from?: string; to?: string; stops?: number };
export type TransitRoute = { minutes: number; transfers: number; fare_yen: number | null; steps: TransitStep[]; summary: string; walk_minutes?: number; tags?: string[] };

const walkMinutes = (r: TransitRoute) => r.steps.reduce((m, s) => m + (s.kind === 'walk' ? s.minutes : 0), 0);

/** The same route twice (Google sometimes repeats one): same lines in the same order, same time. */
const sameRoute = (a: TransitRoute, b: TransitRoute) =>
  a.minutes === b.minutes && JSON.stringify(a.steps.filter(s => s.kind === 'transit').map(s => [s.line, s.from, s.to])) === JSON.stringify(b.steps.filter(s => s.kind === 'transit').map(s => [s.line, s.from, s.to]));

/** Candidates in order of time (the shortest first), without repeats, each marked with what it is best at: 最短 / 乗換が少ない / 歩きが少ない / 運賃が安い.
 *  A mark goes to one route only, and only when that route is alone in being the best at it. A single route gets no marks. */
export function rankRoutes(routes: TransitRoute[], max = 4): TransitRoute[] {
  const list = routes.map(r => ({ ...r, walk_minutes: walkMinutes(r) })).sort((a, b) => a.minutes - b.minutes)
    .filter((r, i, all) => all.findIndex(x => sameRoute(x, r)) === i).slice(0, max);
  if (list.length < 2) return list.map(r => ({ ...r, tags: [] }));
  const tags = list.map((): string[] => []);
  const best = (label: string, value: (r: TransitRoute) => number | null) => {
    const vals = list.map(value);
    const known = vals.filter((v): v is number => v !== null);
    if (known.length < 2 || Math.min(...known) === Math.max(...known)) return;
    const low = Math.min(...known);
    if (vals.filter(v => v === low).length !== 1) return; // a tie is not "the best at it"
    tags[vals.indexOf(low)].push(label);
  };
  tags[0].push('最短');
  best('乗換が少ない', r => r.transfers);
  best('歩きが少ない', r => r.walk_minutes ?? null);
  best('運賃が安い', r => r.fare_yen);
  return list.map((r, i) => ({ ...r, tags: tags[i] }));
}

/** Yahoo!乗換案内 with the places, the day and the time (出発) filled in. */
export function yahooTransitLink({ from, to, date, time }: TransitQuery): string {
  const [y, m, d] = date.split('-');
  const [hh, mm] = (time && /^\d{2}:\d{2}$/.test(time) ? time : '09:00').split(':');
  const q = new URLSearchParams({ from, to, y, m: String(Number(m)), d: String(Number(d)), hh: String(Number(hh)), m1: mm[0], m2: mm[1], type: '1', ticket: 'ic' });
  return `https://transit.yahoo.co.jp/search/result?${q}`;
}

/** Google Maps' public transport directions. */
export function googleTransitLink({ from, to }: TransitQuery): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=transit`;
}

/** One line of text for the approver: "新宿 → 川越: JR埼京線（新宿→川越） 約45分・乗換0回・運賃 ¥590" */
export function describeRoute(from: string, to: string, r: TransitRoute): string {
  const lines = r.steps.filter(s => s.kind === 'transit').map(s => `${s.line ?? '電車・バス'}（${s.from ?? ''}→${s.to ?? ''}）`).join(' → ');
  return `${from} → ${to}: ${lines || '徒歩'} 約${r.minutes}分・乗換${r.transfers}回${r.fare_yen !== null ? `・運賃 ¥${r.fare_yen.toLocaleString('ja-JP')}` : ''}`.slice(0, 500);
}
