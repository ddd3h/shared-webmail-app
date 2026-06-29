import { NextRequest, NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth';
import { clearAvatarCache } from '@/lib/avatar-cache';

async function performLogout() {
  try {
    const session = await getSession();
    if (session?.userId) await clearAvatarCache(session.userId);
    if (session?.sessionId) await clearSession(session.sessionId);
  } catch {}
}

export async function POST() {
  await performLogout();
  const res = NextResponse.json({ ok: true });
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

// GET handler for direct navigation logout (more reliable when fetch is blocked by extensions)
export async function GET(req: NextRequest) {
  await performLogout();
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
