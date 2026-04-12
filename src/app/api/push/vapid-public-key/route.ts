import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

// GET /api/push/vapid-public-key - accessible to all authenticated users
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const publicKey = await getSetting('VAPID_PUBLIC_KEY');
  if (!publicKey) {
    return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  }

  return NextResponse.json({ publicKey });
}
