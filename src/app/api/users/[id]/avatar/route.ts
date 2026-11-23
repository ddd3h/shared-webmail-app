import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadAvatar } from '@/lib/avatar';
import { matchesEtag } from '@/lib/image-store';

// GET /api/users/[id]/avatar — the person's Mattermost profile picture (kept in memory and in the database, see lib/avatar.ts).
// The browser asks every time (no-cache) and gets 304, without the picture, when it already has this one. Both answers need a
// live session. The picture came from elsewhere, so it is sent with headers that keep it from running as a page (an SVG's script).
const HEADERS = { 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const user = await prisma.users.findUnique({ where: { id }, select: { mattermost_user_id: true } });
  const avatar = user?.mattermost_user_id ? await loadAvatar(id, user.mattermost_user_id) : null;
  if (!avatar) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-cache' } });
  if (matchesEtag(req.headers.get('if-none-match'), avatar.etag)) {
    return new NextResponse(null, { status: 304, headers: { ...HEADERS, ETag: avatar.etag } });
  }
  return new NextResponse(Buffer.from(avatar.base64, 'base64') as unknown as BodyInit, {
    headers: { ...HEADERS, 'Content-Type': avatar.contentType, ETag: avatar.etag },
  });
}
