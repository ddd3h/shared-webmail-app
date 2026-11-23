import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { lookupSenderIcon } from '@/lib/sender-icon';
import { matchesEtag } from '@/lib/image-store';

// GET /api/sender-icon?email=... — 送信者アイコン（BIMI → 企業favicon → Gravatar）。メモリとDBに残す（lib/sender-icon.ts）。
// 同じアイコンをすでに持っているブラウザには 304（中身なし）。どちらもログイン中の人だけ。
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

  if (matchesEtag(req.headers.get('if-none-match'), icon.etag)) {
    return new NextResponse(null, { status: 304, headers: { ETag: icon.etag, 'Cache-Control': 'private, max-age=86400' } });
  }
  return new NextResponse(icon.data as unknown as BodyInit, {
    headers: {
      'Content-Type': icon.contentType,
      'Cache-Control': 'private, max-age=86400',
      ETag: icon.etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Icon-Source': icon.source,
    },
  });
}
