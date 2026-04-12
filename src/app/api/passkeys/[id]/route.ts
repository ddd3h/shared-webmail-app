import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const cred = await prisma.passkey_credentials.findUnique({ where: { id } });
  if (!cred || cred.user_id !== session.userId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await prisma.passkey_credentials.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
