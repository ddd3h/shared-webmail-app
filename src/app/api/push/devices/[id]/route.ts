import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// DELETE /api/push/devices/[id] - remove a specific push subscription
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  await prisma.push_subscriptions.deleteMany({
    where: { id, user_id: session!.userId }
  });

  return NextResponse.json({ ok: true });
}
