import { describe, it, expect } from 'vitest';
import { addDays, layoutDay, minutesOnDay, parseYmd, shiftAnchor, startOfWeek, viewTitle, visibleDays, ymd } from '@/lib/calendar-view';

const d = (s: string) => parseYmd(s);
const at = (day: string, h: number, m = 0) => { const x = d(day); x.setHours(h, m); return x; };
const span = (id: string, day: string, h1: number, h2: number) => ({ id, start: at(day, h1), end: at(day, h2) });

describe('visibleDays / shiftAnchor', () => {
  it('日: その1日だけ', () => expect(visibleDays('day', d('2026-10-26')).map(ymd)).toEqual(['2026-10-26']));
  it('週: 日曜はじまりの7日（日曜日を選んでも、土曜日を選んでも同じ週）', () => {
    const week = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
    expect(visibleDays('week', d('2026-10-26')).map(ymd)).toEqual(week);
    expect(visibleDays('week', d('2026-10-25')).map(ymd)).toEqual(week);
    expect(visibleDays('week', d('2026-10-31')).map(ymd)).toEqual(week);
  });
  it('月: その月の1日を含む週から6週間（42日）', () => {
    const days = visibleDays('month', d('2026-10-15'));
    expect(days).toHaveLength(42);
    expect(ymd(days[0])).toBe('2026-09-27'); // 10/1 is a Thursday
    expect(ymd(days[41])).toBe('2026-11-07');
    expect(days.some(x => ymd(x) === '2026-10-31')).toBe(true);
  });
  it('1つ進む・戻る: 日は1日、週は7日、月は翌月・前月の1日（月をまたぐ・年をまたぐ）', () => {
    expect(ymd(shiftAnchor('day', d('2026-10-31'), 1))).toBe('2026-11-01');
    expect(ymd(shiftAnchor('week', d('2026-12-30'), 1))).toBe('2027-01-06');
    expect(ymd(shiftAnchor('week', d('2026-01-03'), -1))).toBe('2025-12-27');
    expect(ymd(shiftAnchor('month', d('2026-12-15'), 1))).toBe('2027-01-01');
    expect(ymd(shiftAnchor('month', d('2026-01-31'), -1))).toBe('2025-12-01');
    expect(ymd(shiftAnchor('month', d('2026-03-31'), 1))).toBe('2026-04-01'); // 31st + 1 month never skips a month
  });
  it('startOfWeek / addDays', () => { expect(ymd(startOfWeek(d('2026-10-28')))).toBe('2026-10-25'); expect(ymd(addDays(d('2026-02-28'), 1))).toBe('2026-03-01'); });
});

describe('viewTitle', () => {
  it('月・日・週（同じ月／月をまたぐ週）', () => {
    expect(viewTitle('month', d('2026-10-26'))).toBe('2026年10月');
    expect(viewTitle('day', d('2026-10-26'))).toBe('2026年10月26日（月）');
    expect(viewTitle('week', d('2026-10-26'))).toBe('2026年10月25日 – 31日');
    expect(viewTitle('week', d('2026-10-29'))).toBe('2026年10月25日 – 31日');
    expect(viewTitle('week', d('2026-11-02'))).toBe('2026年11月1日 – 7日');
    expect(viewTitle('week', d('2026-09-30'))).toBe('2026年9月27日 – 10月3日');
  });
});

describe('minutesOnDay', () => {
  it('その日の中の予定は、0時からの分で返る', () => expect(minutesOnDay(span('a', '2026-10-26', 10, 11), d('2026-10-26'))).toEqual({ from: 600, to: 660 }));
  it('別の日の予定は null', () => expect(minutesOnDay(span('a', '2026-10-26', 10, 11), d('2026-10-27'))).toBeNull());
  it('日をまたぐ予定は、それぞれの日の分だけ切り取る', () => {
    const night = { id: 'n', start: at('2026-10-26', 22), end: at('2026-10-27', 2) };
    expect(minutesOnDay(night, d('2026-10-26'))).toEqual({ from: 1320, to: 1440 });
    expect(minutesOnDay(night, d('2026-10-27'))).toEqual({ from: 0, to: 120 });
    expect(minutesOnDay(night, d('2026-10-28'))).toBeNull();
  });
  it('0時ちょうどに終わる予定は、次の日には出ない', () => expect(minutesOnDay({ id: 'x', start: at('2026-10-26', 23), end: at('2026-10-27', 0) }, d('2026-10-27'))).toBeNull());
  it('とても短い予定も、クリックできる高さ（20分）は確保する。長さのない予定は開始時刻に置く', () => {
    expect(minutesOnDay({ id: 's', start: at('2026-10-26', 9), end: at('2026-10-26', 9, 5) }, d('2026-10-26'))).toEqual({ from: 540, to: 560 });
    expect(minutesOnDay({ id: 'z', start: at('2026-10-26', 9), end: at('2026-10-26', 9) }, d('2026-10-26'))).toEqual({ from: 540, to: 560 });
  });
  it('23:50 の短い予定も、1日の枠からはみ出さない', () => {
    const r = minutesOnDay({ id: 'l', start: at('2026-10-26', 23, 50), end: at('2026-10-26', 23, 55) }, d('2026-10-26'))!;
    expect(r.to).toBeLessThanOrEqual(1440);
    expect(r.to - r.from).toBeGreaterThanOrEqual(20);
  });
});

describe('layoutDay', () => {
  const day = d('2026-10-26');
  it('重ならない予定は、それぞれ幅いっぱい（1列）', () => {
    const placed = layoutDay([span('a', '2026-10-26', 9, 10), span('b', '2026-10-26', 10, 11)], day);
    expect(placed.map(p => [p.item.id, p.column, p.columns])).toEqual([['a', 0, 1], ['b', 0, 1]]);
  });
  it('重なる予定は並べる（2列）。重ならなくなったら1列に戻る', () => {
    const placed = layoutDay([span('a', '2026-10-26', 9, 11), span('b', '2026-10-26', 10, 12), span('c', '2026-10-26', 13, 14)], day);
    const by = Object.fromEntries(placed.map(p => [p.item.id, p]));
    expect([by.a.column, by.a.columns, by.b.column, by.b.columns]).toEqual([0, 2, 1, 2]);
    expect([by.c.column, by.c.columns]).toEqual([0, 1]);
  });
  it('3つが同時なら3列。先に終わった列は次の予定が使う', () => {
    const placed = layoutDay([span('a', '2026-10-26', 9, 12), span('b', '2026-10-26', 9, 10), span('c', '2026-10-26', 9, 11), span('d', '2026-10-26', 10, 11)], day);
    const by = Object.fromEntries(placed.map(p => [p.item.id, p]));
    expect(by.a.columns).toBe(3);
    expect(new Set([by.a.column, by.b.column, by.c.column]).size).toBe(3);
    expect(by.d.column).toBe(by.b.column); // b ended at 10:00, so d takes its place
  });
  it('他の日の予定は含めない。top / height は分', () => {
    const placed = layoutDay([span('a', '2026-10-26', 9, 10), span('x', '2026-10-27', 9, 10)], day);
    expect(placed).toHaveLength(1);
    expect([placed[0].top, placed[0].height]).toEqual([540, 60]);
  });
});
