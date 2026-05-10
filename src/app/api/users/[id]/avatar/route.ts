import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCachedAvatar, saveAvatarCache } from '@/lib/avatar-cache';

// GET /api/users/[id]/avatar — proxy Mattermost profile picture (with 24h file cache)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  // Serve from cache if fresh
  const cached = await getCachedAvatar(id);
  if (cached) {
    return new NextResponse(cached.data as unknown as BodyInit, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'private, no-cache',
        'X-Avatar-Source': 'cache',
      },
    });
  }

  const user = await prisma.users.findUnique({
    where: { id },
    select: { mattermost_user_id: true },
  });

  if (!user?.mattermost_user_id) {
    return new NextResponse(null, { status: 404 });
  }

  const settings = await prisma.app_settings.findMany({
    where: { key: { in: ['MATTERMOST_BASE_URL', 'MATTERMOST_BOT_TOKEN'] } },
  });
  const getSetting = (key: string) => settings.find(s => s.key === key)?.value || '';
  const baseUrl = (getSetting('MATTERMOST_BASE_URL') || process.env.MATTERMOST_BASE_URL || '').replace(/\/+$/, '');
  const botToken = getSetting('MATTERMOST_BOT_TOKEN') || process.env.MATTERMOST_BOT_TOKEN;

  if (!baseUrl || !botToken) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const imgRes = await fetch(`${baseUrl}/api/v4/users/${user.mattermost_user_id}/image`, {
      headers: { Authorization: `Bearer ${botToken}`, 'User-Agent': 'WebMailApp/1.0' },
      cache: 'no-cache',
    });

    if (!imgRes.ok) return new NextResponse(null, { status: 404 });

    const arrayBuf = await imgRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const contentType = imgRes.headers.get('content-type') || 'image/png';

    // Save to cache (fire-and-forget, don't block response)
    saveAvatarCache(id, buf, contentType).catch(() => {});

    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-cache',
        'X-Avatar-Source': 'mattermost',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
