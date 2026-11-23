import { NextRequest, NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth';
import { DEVICE_COOKIE } from '@/lib/known-device';
import { forgetRemembered } from '@/lib/remember-login';

// Logging out is a decision: this browser has to log in with a password again (the installed app's automatic login ends too)
async function performLogout(deviceToken?: string) {
  try {
    if (deviceToken) await forgetRemembered({ token: deviceToken });
    // the profile picture stays kept (lib/avatar.ts): it belongs to the person, not to this login, and every logged-in person may see it
    const session = await getSession();
    if (session?.sessionId) await clearSession(session.sessionId);
  } catch {}
}

export async function POST(req: NextRequest) {
  await performLogout(req.cookies.get(DEVICE_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

// GET handler for direct navigation logout (more reliable when fetch is blocked by extensions)
export async function GET(req: NextRequest) {
  await performLogout(req.cookies.get(DEVICE_COOKIE)?.value);
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
