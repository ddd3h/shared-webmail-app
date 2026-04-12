import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';

// POST /api/profile/password-reset  { token, newPassword }
export async function POST(req: NextRequest) {
  const { token, newPassword } = await req.json().catch(() => ({}));
  if (!token || !newPassword) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
  }

  const record = await prisma.password_reset_tokens.findUnique({ where: { token } });
  if (!record || record.used || record.expires_at < new Date()) {
    return NextResponse.json({ error: 'token_invalid' }, { status: 400 });
  }

  const hash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.users.update({ where: { id: record.user_id }, data: { password_hash: hash } }),
    prisma.password_reset_tokens.update({ where: { id: record.id }, data: { used: true } })
  ]);

  return NextResponse.json({ ok: true });
}
