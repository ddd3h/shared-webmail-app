import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, refreshSessionCookie } from '@/lib/auth';

const PUBLIC_PATHS = ['/login', '/reset-password', '/api/auth/login', '/api/auth/logout', '/api/cron/', '/api/passkeys/auth-options', '/api/passkeys/auth'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/manifest') ||
    pathname.startsWith('/sw.js') ||
    pathname.startsWith('/icons') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const { session } = await getSessionFromRequest(req);
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    if (!pathname.startsWith('/api/')) {
      loginUrl.searchParams.set('from', pathname);
    }
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete('sid'); // clear stale/expired cookie
    return res;
  }

  // Admin-only paths
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (session.role !== 'admin') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Refresh the session cookie on every request (sliding window)
  const res = NextResponse.next();
  await refreshSessionCookie(res, session);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
