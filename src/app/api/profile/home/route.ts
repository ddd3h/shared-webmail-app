import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { MAX_ADDRESS_LENGTH } from '@/lib/mileage';

// GET /api/profile/home - the person's own home address (the start of their own-car claims)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const u = await prisma.users.findUnique({ where: { id: session.userId }, select: { home_address: true } });
  if (!u) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ home_address: u.home_address });
}

const schema = z.object({ home_address: z.string().trim().max(MAX_ADDRESS_LENGTH).nullable() });

// PUT /api/profile/home - an empty address clears it. The address itself is not written to the audit log.
export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const home = parsed.data.home_address || null;
  await prisma.users.update({ where: { id: session.userId }, data: { home_address: home } });
  await logAudit({ actorUserId: session.userId, actionType: 'home_address_update', targetType: 'users', targetId: session.userId, metadata: { set: !!home } });
  return NextResponse.json({ home_address: home });
}
