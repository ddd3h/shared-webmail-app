import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/password';

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
  }

  const user = await prisma.users.findUnique({ where: { id: session.userId } });
  if (!user?.password_hash) {
    return NextResponse.json({ error: 'no_password' }, { status: 400 });
  }

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'wrong_current_password' }, { status: 400 });
  }

  const newHash = await hashPassword(newPassword);
  await prisma.users.update({
    where: { id: session.userId },
    data: { password_hash: newHash }
  });

  return NextResponse.json({ ok: true });
}
