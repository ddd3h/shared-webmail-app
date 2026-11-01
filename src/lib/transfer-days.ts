// 振込申請の振込日: 月に2回（15日と25日）。支払期日に間に合う一番遅い振込日を自動で割り当てる。
// 土日の場合は前の平日に早める。pure（I/Oなし）なので、画面・API・月次まとめで同じ計算を使う。
import { addDays, addMonths } from '@/lib/pay-schedule';

export const TRANSFER_DAYS = [15, 25] as const;
export type TransferDay = (typeof TRANSFER_DAYS)[number];
export const transferDayLabel = (d: TransferDay) => `${d}日振込`;

export type TransferSlot = { date: string; day: TransferDay; late: boolean };

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

/** The actual bank day of a nominal 振込日: a Saturday / Sunday moves to the Friday before. */
function bankDay(ym: string, day: TransferDay): string {
  const raw = `${ym}-${String(day).padStart(2, '0')}`;
  const wd = weekday(raw);
  return wd === 6 ? addDays(raw, -1) : wd === 0 ? addDays(raw, -2) : raw;
}

/** Every 振込日 from the month before `from` to the month after `to`, oldest first. */
function slotsAround(from: string, to: string): { date: string; day: TransferDay }[] {
  const out: { date: string; day: TransferDay }[] = [];
  for (let ym = addMonths(from.slice(0, 7), -1); ym <= addMonths(to.slice(0, 7), 1); ym = addMonths(ym, 1)) {
    for (const day of TRANSFER_DAYS) out.push({ date: bankDay(ym, day), day });
  }
  return out;
}

/**
 * The 振込日 a payment request is paid on: the latest one that is on or before the due date and not already past.
 * When every one before the due date has gone by, it is the next one (`late: true` — it will be paid after the due date).
 */
export function transferSlotFor(due: string, today: string): TransferSlot {
  const slots = slotsAround(today < due ? today : due, due > today ? due : today);
  const fits = slots.filter(s => s.date <= due && s.date >= today);
  if (fits.length) return { ...fits[fits.length - 1], late: false };
  const next = slots.find(s => s.date >= today)!;
  return { ...next, late: next.date > due };
}

/** Which 振込日 (15日 / 25日) a date is, or null when it is not one. */
export function slotOfDate(date: string): TransferDay | null {
  return slotsAround(date, date).find(s => s.date === date)?.day ?? null;
}

/** "11/15（15日振込）" */
export function transferSlotLabel(s: TransferSlot): string {
  return `${s.date.slice(5, 7).replace(/^0/, '')}/${s.date.slice(8).replace(/^0/, '')}（${transferDayLabel(s.day)}）`;
}
