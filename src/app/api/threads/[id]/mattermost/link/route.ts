import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { canViewThread } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const { channel_id, post_id, root_post_id, permalink } = await req.json().catch(() => ({}));
  if (!channel_id || !permalink || typeof permalink !== 'string') return NextResponse.json({ error: 'invalid' }, { status: 400 });
  if (!(await canViewThread(session!.userId, id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // the link is shown to everybody who opens the thread: it has to lead to the company's Mattermost, not to anywhere a caller likes
  const base = (await getSetting('MATTERMOST_BASE_URL')) || process.env.MATTERMOST_BASE_URL;
  let url: URL | null = null;
  try { url = new URL(permalink); } catch { /* not a URL */ }
  if (!url || !/^https?:$/.test(url.protocol) || !base || url.origin !== new URL(base).origin) return NextResponse.json({ error: 'invalid_permalink' }, { status: 400 });
  await prisma.mattermost_links.upsert({
    where: { thread_id: id },
    create: { thread_id: id, mattermost_channel_id: channel_id, mattermost_post_id: post_id || '', mattermost_root_post_id: root_post_id || post_id || '', permalink, created_by_user_id: session!.userId },
    update: { mattermost_channel_id: channel_id, mattermost_post_id: post_id || '', mattermost_root_post_id: root_post_id || post_id || '', permalink }
  });
  await logAudit({ actorUserId: session!.userId, actionType: 'mm_link', targetType: 'threads', targetId: id, metadata: { permalink } });
  return NextResponse.json({ ok: true });
}

