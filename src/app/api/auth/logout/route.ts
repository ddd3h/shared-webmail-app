import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { clearAvatarCache } from '@/lib/avatar-cache';

async function clearSessionAvatar() {
  try {
    const session = await getSession();
    if (session?.userId) await clearAvatarCache(session.userId);
  } catch {}
}

export async function POST() {
  await clearSessionAvatar();
  const res = NextResponse.json({ ok: true });
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

// GET handler for direct navigation logout (more reliable when fetch is blocked by extensions)
export async function GET(req: NextRequest) {
  await clearSessionAvatar();
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
