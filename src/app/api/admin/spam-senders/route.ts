import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await prisma.users.findUnique({ where: { id: session!.userId }, select: { role: true } });
  if (actor?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const entries = await prisma.spam_senders.findMany({
    orderBy: [{ type: 'asc' }, { created_at: 'desc' }],
    include: { creator: { select: { name: true } } }
  });

  return NextResponse.json({ items: entries });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await prisma.users.findUnique({ where: { id: session!.userId }, select: { role: true } });
  if (actor?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const type = body?.type as string | undefined;
  const address = (body?.address as string | undefined)?.toLowerCase().trim();
  const note = (body?.note as string | undefined) || null;

  if (!type || !['whitelist', 'blocklist'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }

  try {
    const entry = await prisma.spam_senders.create({
      data: { type, address, note, created_by_id: session!.userId }
    });
    return NextResponse.json({ item: entry });
  } catch {
    return NextResponse.json({ error: 'already exists' }, { status: 409 });
  }
}
