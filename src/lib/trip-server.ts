// DB-side helpers shared by the trip routes.
import { prisma } from '@/lib/db';
import { computeLines, datesOverlap, linesTotal, tripDays, tripNights, validateSelection, type AllowanceType } from '@/lib/trip';

export const tripInclude = {
  user: { select: { id: true, name: true } },
  reviewer: { select: { name: true } },
  allowances: { orderBy: { sort: 'asc' as const } },
  expense_claims: {
    select: { id: true, title: true, amount: true, payment_method: true, status: true, expense_date: true },
    orderBy: { expense_date: 'asc' as const },
  },
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function serializeTrip(t: any) {
  const start = ymd(t.start_date), end = ymd(t.end_date);
  return {
    id: t.id,
    user: t.user,
    destination: t.destination,
    purpose: t.purpose,
    start_date: start,
    end_date: end,
    days: tripDays(start, end),
    nights: tripNights(start, end),
    status: t.status,
    reviewer: t.reviewer?.name ?? null,
    reviewed_at: t.reviewed_at,
    review_comment: t.review_comment,
    allowances: t.allowances.map((l: any) => ({
      id: l.id, type_id: l.type_id, name: l.name, kind: l.kind, unit: l.unit, rate: l.rate, quantity: l.quantity, amount: l.amount,
    })),
    allowance_total: linesTotal(t.allowances),
    expenses: t.expense_claims.map((c: any) => ({
      id: c.id, title: c.title, amount: c.amount, payment_method: c.payment_method, status: c.status, expense_date: ymd(c.expense_date),
    })),
    expenses_total: t.expense_claims.reduce((s: number, c: any) => s + c.amount, 0),
  };
}

// Resolve the chosen 日当 / 加算金 into active rate-master rows. Returns an error code instead of throwing.
export async function loadSelection(
  dailyTypeId: string | null | undefined,
  addonTypeIds: string[]
): Promise<{ types: AllowanceType[] } | { error: 'invalid_allowance' | 'multiple_daily' }> {
  const addons = [...new Set(addonTypeIds)];
  const ids = [...(dailyTypeId ? [dailyTypeId] : []), ...addons];
  if (ids.length === 0) return { types: [] };
  const rows = await prisma.trip_allowance_types.findMany({ where: { id: { in: ids }, is_active: true } });
  if (rows.length !== new Set(ids).size) return { error: 'invalid_allowance' };
  const types = rows as unknown as AllowanceType[];
  if (dailyTypeId && types.find(t => t.id === dailyTypeId)?.kind !== 'daily') return { error: 'invalid_allowance' };
  if (addons.some(id => types.find(t => t.id === id)?.kind !== 'addon')) return { error: 'invalid_allowance' };
  if (validateSelection(types)) return { error: 'multiple_daily' };
  return { types };
}

export function linesData(types: AllowanceType[], start: string, end: string) {
  return computeLines(types, start, end).map((l, sort) => ({ ...l, sort }));
}

// Another active (pending/approved) trip of the same person that overlaps the dates?
export async function findOverlap(userId: string, start: string, end: string, excludeId?: string) {
  const others = await prisma.business_trips.findMany({
    where: { user_id: userId, status: { in: ['pending', 'approved'] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, destination: true, start_date: true, end_date: true },
  });
  return others.find(o => datesOverlap(start, end, ymd(o.start_date), ymd(o.end_date)));
}

// May this person attach an expense to this trip? Only their own approved trips.
export async function checkTripLink(userId: string, tripId: string): Promise<boolean> {
  const t = await prisma.business_trips.findUnique({ where: { id: tripId }, select: { user_id: true, status: true } });
  return !!t && t.user_id === userId && t.status === 'approved';
}
