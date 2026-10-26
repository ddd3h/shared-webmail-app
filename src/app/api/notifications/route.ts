import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { listNotifications, unreadNotificationCount } from '@/lib/notifications';

// GET /api/notifications?unread=1&limit=30&before=<ISO>  - my notifications, newest first
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const sp = new URL(req.url).searchParams;
  const before = sp.get('before') ? new Date(sp.get('before')!) : undefined;
  if (before && isNaN(before.getTime())) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const limit = Number(sp.get('limit')) || 30;
  const [{ items, next }, unread] = await Promise.all([
    listNotifications(session.userId, { limit, before, unreadOnly: sp.get('unread') === '1' }),
    unreadNotificationCount(session.userId),
  ]);
  return NextResponse.json({ items, unread, next });
}
