import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    calendar_events: { findUnique: vi.fn(), update: vi.fn() },
    calendar_event_attendees: { deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async () => []),
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1', role: 'user' })), requireAuth: vi.fn() }));
vi.mock('@/lib/calendar-server', async () => ({ ...(await vi.importActual<object>('@/lib/calendar-server')), validAttendees: vi.fn() }));
vi.mock('@/lib/work-notify', () => ({ notifyEventInvited: vi.fn() }));

import { prisma } from '@/lib/db';
import { validAttendees } from '@/lib/calendar-server';
import { notifyEventInvited } from '@/lib/work-notify';
import { PATCH } from '@/app/api/calendar/events/[id]/route';

const patch = (body: object) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id: 'e1' }) });
const gev = (owner: string) => ({ id: 'e1', source: 'google', owner_user_id: owner, created_by_id: null, attendees: [{ user_id: 'u3' }] });

beforeEach(() => vi.resetAllMocks());

describe('PATCH Google取り込みの予定の参加者', () => {
  it('持ち主は参加者を入れ替えられ、新しい人にだけ招待を送る', async () => {
    (prisma.calendar_events.findUnique as any).mockResolvedValue(gev('u1'));
    (validAttendees as any).mockResolvedValue(['u2', 'u3']);
    const r = await patch({ attendee_ids: ['u2', 'u3'] });
    expect(r.status).toBe(200);
    expect(prisma.calendar_event_attendees.create).toHaveBeenCalledTimes(1);
    expect(notifyEventInvited).toHaveBeenCalledWith('e1', 'u1', ['u2']);
  });
  it('持ち主でない人は403で、何も変えない', async () => {
    (prisma.calendar_events.findUnique as any).mockResolvedValue(gev('u9'));
    expect((await patch({ attendee_ids: ['u2'] })).status).toBe(403);
    expect(prisma.calendar_event_attendees.create).not.toHaveBeenCalled();
  });
  it('社内の人でない参加者がいると400', async () => {
    (prisma.calendar_events.findUnique as any).mockResolvedValue(gev('u1'));
    (validAttendees as any).mockResolvedValue(null);
    expect((await patch({ attendee_ids: ['zz'] })).status).toBe(400);
  });
  it('名前だけの変更では参加者に触れない', async () => {
    (prisma.calendar_events.findUnique as any).mockResolvedValue(gev('u1'));
    expect((await patch({ title_override: '打合せ' })).status).toBe(200);
    expect(prisma.calendar_event_attendees.deleteMany).not.toHaveBeenCalled();
    expect(prisma.calendar_events.update).toHaveBeenCalled();
  });
});
