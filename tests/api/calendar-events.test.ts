import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    calendar_events: { findMany: vi.fn(), create: vi.fn() },
    calendar_google_links: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'u1', role: 'user' })),
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({ listPeople: vi.fn(async () => [{ id: 'u1', name: '田中' }, { id: 'u2', name: '佐藤' }]) }));
vi.mock('@/lib/calendar-server', async () => ({
  ...(await vi.importActual<object>('@/lib/calendar-server')),
  calendarPeople: vi.fn(),
  validAttendees: vi.fn(),
}));
vi.mock('@/lib/google-calendar', () => ({ syncStaleLinks: vi.fn() }));
vi.mock('@/lib/work-notify', () => ({ notifyEventInvited: vi.fn() }));

import { prisma } from '@/lib/db';
import { calendarPeople, validAttendees } from '@/lib/calendar-server';
import { notifyEventInvited } from '@/lib/work-notify';
import { GET, POST } from '@/app/api/calendar/events/route';

const get = (qs: string) => GET(new Request(`http://x/api/calendar/events?${qs}`) as any);
const Q = 'from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';

beforeEach(() => vi.resetAllMocks());

describe('GET /api/calendar/events', () => {
  it('共有メールのメンバーのカレンダーは、そのメールを見られない人には403', async () => {
    (calendarPeople as any).mockResolvedValue(null);
    expect((await get(`mailboxId=m1&${Q}`)).status).toBe(403);
  });

  it('期間が不正なら400', async () => {
    expect((await get('from=x&to=y')).status).toBe(400);
  });

  it('「予定あり」のみの連携は詳細を返さず、名前変更は反映される。参加者と、編集できるかも返す', async () => {
    (calendarPeople as any).mockResolvedValue([{ id: 'u1', name: '田中' }]);
    (prisma.calendar_google_links.findMany as any).mockResolvedValue([]);
    const link = { id: 'l1', name: 'G', color: '#000000', display_mode: 'busy_only', busy_label: '予定あり' };
    const base = { source: 'google', description: 'leak', location: 'leak', all_day: false, start_at: new Date(), end_at: new Date(), creator: null, owner: { id: 'u1', name: '田中' }, owner_user_id: 'u1', created_by_id: null, attendees: [], link };
    (prisma.calendar_events.findMany as any).mockResolvedValue([
      { ...base, id: 'e1', title: 'leak-title', title_override: null },
      { ...base, id: 'e2', title: 'leak-title', title_override: '社内MTG', owner: { id: 'u2', name: '佐藤' }, owner_user_id: 'u2' },
    ]);
    const body = await (await get(Q)).json();
    expect(body.items.map((i: any) => i.title)).toEqual(['予定あり', '社内MTG']);
    expect(JSON.stringify(body)).not.toContain('leak');
    expect(body.items[0]).toMatchObject({ owner: { id: 'u1', name: '田中' }, attendees: [], can_edit: true });
    expect(body.items[1].can_edit).toBe(false); // somebody else's imported event: only its owner renames it
    expect(body.people).toEqual([{ id: 'u1', name: '田中' }]);
    expect(body.everybody).toHaveLength(2);
  });

  it('自分のカレンダーは「自分が主催か参加」の予定だけを探す', async () => {
    (calendarPeople as any).mockResolvedValue([{ id: 'u1', name: '田中' }]);
    (prisma.calendar_google_links.findMany as any).mockResolvedValue([]);
    (prisma.calendar_events.findMany as any).mockResolvedValue([]);
    await get(Q);
    expect((prisma.calendar_events.findMany as any).mock.calls[0][0].where.OR).toEqual([
      { owner_user_id: { in: ['u1'] } }, { attendees: { some: { user_id: { in: ['u1'] } } } },
    ]);
  });
});

describe('POST /api/calendar/events', () => {
  const post = (b: object) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as any);
  const valid = { title: '会議', start_at: '2026-10-20T01:00:00Z', end_at: '2026-10-20T02:00:00Z' };

  it('終了が開始より前なら400', async () => {
    expect((await post({ ...valid, end_at: '2026-10-19T00:00:00Z' })).status).toBe(400);
  });
  it('社内の人でない参加者がいると400で、作らない', async () => {
    (validAttendees as any).mockResolvedValue(null);
    expect((await post({ ...valid, attendee_ids: ['stranger'] })).status).toBe(400);
    expect(prisma.calendar_events.create).not.toHaveBeenCalled();
  });
  it('自分のカレンダーに作り、参加者にも入る（招待の通知も送る）', async () => {
    (validAttendees as any).mockResolvedValue(['u2']);
    (prisma.calendar_events.create as any).mockResolvedValue({ id: 'e1' });
    expect((await post({ ...valid, attendee_ids: ['u2'] })).status).toBe(201);
    const data = (prisma.calendar_events.create as any).mock.calls[0][0].data;
    expect(data).toMatchObject({ owner_user_id: 'u1', created_by_id: 'u1', attendees: { create: [{ user_id: 'u2' }] } });
    expect(notifyEventInvited).toHaveBeenCalledWith('e1', 'u1', ['u2']);
  });
  it('参加者がいなければ通知しない', async () => {
    (validAttendees as any).mockResolvedValue([]);
    (prisma.calendar_events.create as any).mockResolvedValue({ id: 'e1' });
    expect((await post(valid)).status).toBe(201);
    expect(notifyEventInvited).not.toHaveBeenCalled();
  });
});
