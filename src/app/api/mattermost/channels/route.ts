import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { usableChannels } from '@/lib/mattermost-channels';

// GET /api/mattermost/channels - the channels this person may post a thread to
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  return NextResponse.json({ items: await usableChannels(session.userId, session.role) });
}
