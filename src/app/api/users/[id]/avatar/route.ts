import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { loadAvatar } from '@/lib/avatar';

// GET /api/users/[id]/avatar — the person's Mattermost profile picture (kept for a day by the cache in lib/avatar.ts)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const avatar = await loadAvatar(id);
  if (!avatar) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(avatar.base64, 'base64') as unknown as BodyInit, {
    headers: { 'Content-Type': avatar.contentType, 'Cache-Control': 'private, no-cache' },
  });
}
