import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  requireAuth(session);
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const target = await prisma.sessions.findUnique({
    where: { id },
    select: { id: true, user_id: true },
  });
  if (!target) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await prisma.sessions.delete({ where: { id } });

  await logAudit({
    actorUserId: session.userId,
    actionType: 'session_revoked',
    targetType: 'sessions',
    targetId: id,
    metadata: { target_user_id: target.user_id },
  });

  return NextResponse.json({ ok: true });
}
