import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const passkeys = await prisma.passkey_credentials.findMany({
    where: { user_id: session.userId },
    select: { id: true, name: true, device_type: true, backed_up: true, created_at: true, last_used_at: true },
    orderBy: { created_at: 'desc' }
  });

  return NextResponse.json({ passkeys });
}
