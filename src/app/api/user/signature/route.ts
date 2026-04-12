import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// GET /api/user/signature - get current user's signature
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const user = await prisma.users.findUnique({
    where: { id: session!.userId },
    select: { name: true, email: true, signature: true }
  });

  return NextResponse.json({ signature: user?.signature ?? null, name: user?.name, email: user?.email });
}

// PUT /api/user/signature - update current user's signature
export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const { signature } = await req.json().catch(() => ({}));
  if (typeof signature !== 'string') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  await prisma.users.update({
    where: { id: session!.userId },
    data: { signature }
  });

  return NextResponse.json({ ok: true });
}
