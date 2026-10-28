import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { unreadNotificationCount } from '@/lib/notifications';

// GET /api/notifications/unread-count  - the number on the bell
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  return NextResponse.json({ count: await unreadNotificationCount(session.userId) });
}
