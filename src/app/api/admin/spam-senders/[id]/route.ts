import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  // the role is the one getSession read from the database a moment ago
  if (session!.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  await prisma.spam_senders.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
