import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, requireAuth } from '@/lib/auth';
import { markNotificationsRead, unreadNotificationCount } from '@/lib/notifications';

const schema = z.object({ ids: z.array(z.string().min(1)).max(200).optional(), all: z.boolean().optional() });

// POST /api/notifications/read  { ids: [...] } or { all: true }  - mark mine as read
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const marked = await markNotificationsRead(session.userId, parsed.data);
  return NextResponse.json({ marked, unread: await unreadNotificationCount(session.userId) });
}
