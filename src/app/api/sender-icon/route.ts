import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { lookupSenderIcon } from '@/lib/sender-icon';

export const runtime = 'nodejs';

// GET /api/sender-icon?email=... — 送信者アイコン（BIMI → 企業favicon → Gravatar）
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const email = req.nextUrl.searchParams.get('email') || '';
  if (!email.includes('@') || email.length > 320) {
    return new NextResponse(null, { status: 400 });
  }

  const icon = await lookupSenderIcon(email);
  if (!icon) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, max-age=21600' },
    });
  }

  return new NextResponse(icon.data as unknown as BodyInit, {
    headers: {
      'Content-Type': icon.contentType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Icon-Source': icon.source,
    },
  });
}
