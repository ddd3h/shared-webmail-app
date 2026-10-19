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
vi.mock('@/lib/rbac', () => ({
  canViewCalendar: vi.fn(),
  canEditCalendar: vi.fn(),
  canManageCalendar: vi.fn(),
}));
vi.mock('@/lib/google-calendar', () => ({ syncStaleLinks: vi.fn() }));

import { prisma } from '@/lib/db';
import { canViewCalendar, canEditCalendar, canManageCalendar } from '@/lib/rbac';
import { GET, POST } from '@/app/api/calendar/events/route';

const get = (qs: string) => GET(new Request(`http://x/api/calendar/events?${qs}`) as any);
const Q = 'mailboxId=m1&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';

beforeEach(() => vi.resetAllMocks());

describe('GET /api/calendar/events', () => {
  it('閲覧権限がなければ403', async () => {
    (canViewCalendar as any).mockResolvedValue(false);
    expect((await get(Q)).status).toBe(403);
  });

  it('「予定あり」のみの連携は詳細を返さず、名前変更は反映される', async () => {
    (canViewCalendar as any).mockResolvedValue(true);
    (canEditCalendar as any).mockResolvedValue(false);
    (canManageCalendar as any).mockResolvedValue(false);
    const link = { id: 'l1', name: 'G', color: '#000000', display_mode: 'busy_only', busy_label: '予定あり' };
    const base = { source: 'google', description: 'leak', location: 'leak', all_day: false, start_at: new Date(), end_at: new Date(), creator: null, link };
    (prisma.calendar_events.findMany as any).mockResolvedValue([
      { ...base, id: 'e1', title: 'leak-title', title_override: null },
      { ...base, id: 'e2', title: 'leak-title', title_override: '社内MTG' },
    ]);
    const body = await (await get(Q)).json();
    expect(body.items.map((i: any) => i.title)).toEqual(['予定あり', '社内MTG']);
    expect(JSON.stringify(body)).not.toContain('leak');
    expect(body.links).toEqual([]);
  });
});

describe('POST /api/calendar/events', () => {
  const post = (b: object) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as any);
  const valid = { mailboxId: 'm1', title: '会議', start_at: '2026-10-20T01:00:00Z', end_at: '2026-10-20T02:00:00Z' };

  it('編集権限がなければ403', async () => {
    (canEditCalendar as any).mockResolvedValue(false);
    expect((await post(valid)).status).toBe(403);
    expect(prisma.calendar_events.create).not.toHaveBeenCalled();
  });
  it('終了が開始より前なら400', async () => {
    expect((await post({ ...valid, end_at: '2026-10-19T00:00:00Z' })).status).toBe(400);
  });
  it('権限があれば作成できる', async () => {
    (canEditCalendar as any).mockResolvedValue(true);
    (prisma.calendar_events.create as any).mockResolvedValue({ id: 'e1' });
    expect((await post(valid)).status).toBe(201);
  });
});
