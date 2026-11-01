import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { loadSecurityPolicy } from '@/lib/security-settings';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 200 });
  return NextResponse.json({ authenticated: true, user: session, idle_minutes: session.pwa ? 0 : (await loadSecurityPolicy()).idleMinutes });
}
