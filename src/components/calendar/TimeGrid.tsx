'use client';
import { useEffect, useRef } from 'react';
import { MINUTES_PER_DAY, layoutDay, weekdayLabel, ymd, type Span } from '@/lib/calendar-view';

// The week and day views: one column per day, hours down the side, all-day items in a row above.

export type GridEvent = Span & { allDay: boolean; title: string; sub: string; color: string; open: () => void };
export type GridTodo = { id: string; title: string; done: boolean; overdue: boolean; open: () => void };

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const LABEL_W = '3.25rem';
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(Math.round(min % 60))}`;

export default function TimeGrid({ days, events, todosOn, today, canEdit, onCreate, onPickDay }: {
  days: Date[]; events: GridEvent[]; todosOn: (d: Date) => GridTodo[]; today: string; canEdit: boolean;
  onCreate: (day: Date, minutes: number) => void; onPickDay: (day: Date) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current) body.current.scrollTop = 8 * HOUR_PX - 8; }, [days.length]); // start the view at 8:00
  const cols = { gridTemplateColumns: `${LABEL_W} repeat(${days.length}, minmax(0, 1fr))` };
  const timed = events.filter(e => !e.allDay);
  const allDay = (d: Date) => {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return events.filter(e => e.allDay && e.start < next && (e.end > d || (e.end.getTime() === e.start.getTime() && e.start >= d)));
  };
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div data-testid="time-grid" className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
      <div className={days.length > 1 ? 'min-w-[44rem]' : ''}>
        <div className="grid border-b border-gray-200 bg-gray-50 text-center text-xs text-gray-500" style={cols}>
          <div />
          {days.map(d => {
            const isToday = ymd(d) === today;
            return (
              <button key={ymd(d)} onClick={() => onPickDay(d)} aria-label={`${d.getMonth() + 1}月${d.getDate()}日（${weekdayLabel(d)}）を開く`}
                className={`py-1.5 hover:bg-gray-100 ${d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : ''}`}>
                <span className="block">{weekdayLabel(d)}</span>
                <span className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm ${isToday ? 'bg-blue-600 font-semibold text-white' : 'text-gray-800'}`}>{d.getDate()}</span>
              </button>
            );
          })}
        </div>

        <div className="grid border-b border-gray-200" style={cols} aria-label="終日の予定とToDo">
          <div className="flex items-start justify-end px-1 pt-1 text-[10px] text-gray-400">終日</div>
          {days.map(d => (
            <div key={ymd(d)} className="min-h-7 space-y-0.5 border-l border-gray-100 p-0.5">
              {allDay(d).map(e => (
                <button key={e.id} onClick={e.open} data-testid="grid-allday" className="block w-full truncate rounded-sm px-1 text-left text-[11px] leading-4 text-white" style={{ background: e.color }}>{e.title}</button>
              ))}
              {todosOn(d).map(t => (
                <button key={t.id} onClick={t.open} data-testid="todo-chip"
                  className={`block w-full truncate rounded-sm border border-dashed px-1 text-left text-[11px] leading-4 ${t.done ? 'border-gray-300 text-gray-400 line-through' : t.overdue ? 'border-red-400 bg-red-50 text-red-700' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>{t.done ? '☑' : '☐'} {t.title}</button>
              ))}
            </div>
          ))}
        </div>

        <div ref={body} className="max-h-[36rem] overflow-y-auto">
          <div className="relative grid" style={{ ...cols, height: HOUR_PX * 24 }}>
            <div className="relative">
              {Array.from({ length: 23 }, (_, i) => i + 1).map(h => (
                <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400" style={{ top: h * HOUR_PX }}>{pad(h)}:00</div>
              ))}
            </div>
            {days.map(d => {
              const placed = layoutDay(timed, d);
              const isToday = ymd(d) === today;
              return (
                <div key={ymd(d)} data-testid="day-column" data-date={ymd(d)} className={`relative border-l border-gray-100 ${canEdit ? 'cursor-cell' : ''}`}
                  style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, #f3f4f6 ${HOUR_PX - 1}px, #f3f4f6 ${HOUR_PX}px)` }}
                  onClick={e => {
                    if (!canEdit || e.target !== e.currentTarget) return; // only the empty part of the column, not an event
                    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                    onCreate(d, Math.min(MINUTES_PER_DAY - 30, Math.floor(y / PX_PER_MIN / 30) * 30));
                  }}>
                  {placed.map(p => {
                    const e = p.item;
                    return (
                      <button key={`${e.id}-${p.column}`} onClick={e.open} data-testid="grid-event" title={`${hm(p.top)}–${hm(p.top + p.height)} ${e.title}`}
                        className="absolute overflow-hidden rounded-sm border border-white px-1 text-left text-[11px] leading-4 text-white"
                        style={{ top: p.top * PX_PER_MIN, height: Math.max(14, p.height * PX_PER_MIN - 2), left: `${(p.column / p.columns) * 100}%`, width: `${100 / p.columns}%`, background: e.color }}>
                        <span className="block truncate font-medium">{e.title}</span>
                        {p.height >= 40 && <span className="block truncate opacity-90">{hm(p.top)}–{hm(p.top + p.height)}{e.sub ? ` ・ ${e.sub}` : ''}</span>}
                      </button>
                    );
                  })}
                  {isToday && <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: nowMin * PX_PER_MIN }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
