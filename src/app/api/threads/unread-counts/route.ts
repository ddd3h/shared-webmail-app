import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getUserUnreadCounts } from '@/lib/unread';

// GET /api/threads/unread-counts
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const { personal, team } = await getUserUnreadCounts(session!.userId);
  return NextResponse.json({ personal, team });
}
