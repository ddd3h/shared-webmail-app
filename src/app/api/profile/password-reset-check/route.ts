import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createHash } from 'crypto';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const hash = createHash('sha256').update(token).digest('hex');
  const t = await prisma.password_reset_tokens.findUnique({
    where: { token_hash: hash }
  });

  if (!t) {
    return NextResponse.json({ error: 'invalid' }, { status: 404 });
  }

  if (t.used) {
    return NextResponse.json({ error: 'used' }, { status: 410 });
  }

  if (t.expires_at < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  return NextResponse.json({ ok: true, expires_at: t.expires_at });
}
