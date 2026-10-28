// Pure helpers for business trips (no I/O so they are easy to test and usable in the browser).

export type AllowanceKind = 'daily' | 'addon';
export type AllowanceUnit = 'per_day' | 'per_night' | 'per_trip';
export type TripStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const MAX_TRIP_DAYS = 90;

export const STATUS_LABEL: Record<TripStatus, string> = {
  pending: '承認待ち', approved: '承認済', rejected: '却下', cancelled: '取消',
};
export const KIND_LABEL: Record<AllowanceKind, string> = { daily: '日当', addon: '加算金' };
export const UNIT_LABEL: Record<AllowanceUnit, string> = { per_day: '1日あたり', per_night: '1泊あたり', per_trip: '1回あたり' };

export type AllowanceType = { id: string; name: string; kind: AllowanceKind; unit: AllowanceUnit; amount: number };
export type AllowanceLine = {
  type_id: string; name: string; kind: AllowanceKind; unit: AllowanceUnit; rate: number; quantity: number; amount: number;
};

const DAY_MS = 86_400_000;
const ts = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getTime();

// Inclusive number of days: 10/28 - 10/30 is 3 days (2 nights); a same-day trip is 1 day (0 nights).
export function tripDays(start: string, end: string): number {
  return Math.round((ts(end) - ts(start)) / DAY_MS) + 1;
}
export const tripNights = (start: string, end: string) => tripDays(start, end) - 1;

export function quantityFor(unit: AllowanceUnit, start: string, end: string): number {
  if (unit === 'per_day') return tripDays(start, end);
  if (unit === 'per_night') return tripNights(start, end);
  return 1;
}

// At most one 日当 may be chosen; any number of 加算金.
export function validateSelection(types: Pick<AllowanceType, 'kind'>[]): 'multiple_daily' | null {
  return types.filter(t => t.kind === 'daily').length > 1 ? 'multiple_daily' : null;
}

// Allowance lines for a trip, in a stable order: the 日当 first, then 加算金.
export function computeLines(types: AllowanceType[], start: string, end: string): AllowanceLine[] {
  return [...types]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'daily' ? -1 : 1))
    .map(t => {
      const quantity = quantityFor(t.unit, start, end);
      return { type_id: t.id, name: t.name, kind: t.kind, unit: t.unit, rate: t.amount, quantity, amount: t.amount * quantity };
    });
}

export function linesTotal(lines: { amount: number }[]): number {
  return lines.reduce((s, l) => s + l.amount, 0);
}

export function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

// Is `date` (YYYY-MM-DD) inside the trip? Used to hint when an expense falls outside its trip.
export function withinTrip(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}
