import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// GET /api/push/devices - list push subscriptions for current user
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const devices = await prisma.push_subscriptions.findMany({
    where: { user_id: session!.userId },
    orderBy: { last_seen_at: 'desc' },
    select: {
      id: true,
      platform: true,
      user_agent: true,
      is_active: true,
      last_seen_at: true,
      created_at: true
    }
  });

  return NextResponse.json({ devices });
}
