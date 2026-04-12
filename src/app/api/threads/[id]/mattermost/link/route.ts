import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const { channel_id, post_id, root_post_id, permalink } = await req.json().catch(() => ({}));
  if (!channel_id || !permalink) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  await prisma.mattermost_links.upsert({
    where: { thread_id: id },
    create: { thread_id: id, mattermost_channel_id: channel_id, mattermost_post_id: post_id || '', mattermost_root_post_id: root_post_id || post_id || '', permalink, created_by_user_id: session!.userId },
    update: { mattermost_channel_id: channel_id, mattermost_post_id: post_id || '', mattermost_root_post_id: root_post_id || post_id || '', permalink }
  });
  await logAudit({ actorUserId: session!.userId, actionType: 'mm_link', targetType: 'threads', targetId: id, metadata: { permalink } });
  return NextResponse.json({ ok: true });
}

