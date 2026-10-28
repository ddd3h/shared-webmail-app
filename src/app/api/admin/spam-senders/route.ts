import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { pageWindow, parsePaging } from '@/lib/pagination';

// GET ?type=whitelist|blocklist&page=1&pageSize=50: one page of the list, newest first, with the number of all rows
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  // the role is the one getSession read from the database a moment ago
  if (session!.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const type = params.get('type');
  if (type !== null && !['whitelist', 'blocklist'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const where = type ? { type } : {};
  const { page: wanted, pageSize } = parsePaging(params);

  const total = await prisma.spam_senders.count({ where });
  const { page, pages, skip, take } = pageWindow(wanted, total, pageSize);
  const entries = await prisma.spam_senders.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }], // id breaks ties, so a row never shows on two pages
    skip,
    take,
    relationLoadStrategy: 'join',
    include: { creator: { select: { name: true } } }
  });

  return NextResponse.json({ items: entries, total, page, pages, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  // the role is the one getSession read from the database a moment ago
  if (session!.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
