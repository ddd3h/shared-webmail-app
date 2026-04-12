import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const user = await prisma.users.findUnique({ where: { email } });
  if (!user || !user.password_hash) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, { userId: user.id, email: user.email, role: user.role });
  return res;
}
