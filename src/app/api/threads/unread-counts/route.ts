import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getUnreadCount } from '@/lib/unread';

// GET /api/threads/unread-counts
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const { personal, team } = await getUnreadCount(session!.userId);
  return NextResponse.json({ personal, team });
}
