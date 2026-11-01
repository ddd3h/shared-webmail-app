import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { loadSecurityPolicy } from '@/lib/security-settings';

// POST /api/auth/activity - "the person is still here" (the page sends it while they type, tap or scroll, at most every 30 seconds).
// getSession() has already ended a session that was idle for too long, so a late sign of life cannot bring it back.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  await prisma.sessions.update({ where: { id: session.sessionId }, data: { last_input_at: new Date() } }).catch(() => {});
  return NextResponse.json({ ok: true, idle_minutes: session.pwa ? 0 : (await loadSecurityPolicy()).idleMinutes });
}
