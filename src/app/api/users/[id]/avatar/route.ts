import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET /api/users/[id]/avatar — proxy Mattermost profile picture
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const user = await prisma.users.findUnique({
    where: { id },
    select: { mattermost_user_id: true }
  });

  if (!user?.mattermost_user_id) {
    return new NextResponse(null, { status: 404 });
  }

  const settings = await prisma.app_settings.findMany({
    where: { key: { in: ['MATTERMOST_BASE_URL', 'MATTERMOST_BOT_TOKEN'] } }
  });
  const getSetting = (key: string) => settings.find(s => s.key === key)?.value || '';
  const baseUrl = (getSetting('MATTERMOST_BASE_URL') || process.env.MATTERMOST_BASE_URL || '').replace(/\/+$/, '');
  const botToken = getSetting('MATTERMOST_BOT_TOKEN') || process.env.MATTERMOST_BOT_TOKEN;

  if (!baseUrl || !botToken) {
    console.warn(`MM Avatar Config Missing: URL=${!!baseUrl}, Token=${!!botToken}`);
    return new NextResponse(null, { status: 404 });
  }

  // Debug: Match with user's successful curl
  console.log(`MM Avatar Fetching: ${baseUrl}/api/v4/users/${user.mattermost_user_id}/image (Token ends with: ...${botToken.slice(-4)})`);

  try {
    const avatarUrl = `${baseUrl}/api/v4/users/${user.mattermost_user_id}/image`;
    
    const imgRes = await fetch(avatarUrl, {
      headers: { 
        'Authorization': `Bearer ${botToken}`,
        'User-Agent': 'WebMailApp/1.0'
      },
      // Some enterprise servers might have cert issues in dev
      cache: 'no-cache'
    });

    if (!imgRes.ok) {
      const errText = await imgRes.text().catch(() => 'no-body');
      console.error(`MM Avatar Fetch Error: [${imgRes.status}] for user ${user.mattermost_user_id}. URL: ${avatarUrl}. Response: ${errText.slice(0, 100)}`);
      return new NextResponse(null, { status: 404 });
    }

    const blob = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const contentLength = imgRes.headers.get('content-length');
    
    console.log(`MM Avatar Success: Type=${contentType}, Size=${blob.byteLength} bytes`);

    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType,
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
        'Cache-Control': 'private, no-store',
        'X-Avatar-Source': 'Mattermost'
      }
    });
  } catch (e: any) {
    console.error('MM Avatar Exception:', e.message);
    return new NextResponse(null, { status: 404 });
  }
}
