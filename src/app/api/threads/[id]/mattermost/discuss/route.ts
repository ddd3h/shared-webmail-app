import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';

// POST /api/threads/[id]/mattermost/discuss
// Posts the thread summary to the mailbox's pre-configured Mattermost channel
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const thread = await prisma.threads.findUnique({
    where: { id },
    include: {
      mailbox: true,
      messages: { orderBy: { sent_at: 'asc' }, take: 1 }
    }
  });
  if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (thread.mailbox.type !== 'team') return NextResponse.json({ error: 'personal_mailbox' }, { status: 400 });

  const channelId = thread.mailbox.mattermost_channel_id;
  if (!channelId) return NextResponse.json({ error: 'no_channel_configured' }, { status: 400 });

  // Fetch Mattermost config from app settings or environment
  const settings = await prisma.app_settings.findMany({
    where: { key: { in: ['MATTERMOST_BASE_URL', 'MATTERMOST_BOT_TOKEN'] } }
  });
  const baseUrl = settings.find(s => s.key === 'MATTERMOST_BASE_URL')?.value || process.env.MATTERMOST_BASE_URL;
  const botToken = settings.find(s => s.key === 'MATTERMOST_BOT_TOKEN')?.value || process.env.MATTERMOST_BOT_TOKEN;

  if (!baseUrl || !botToken) return NextResponse.json({ error: 'mattermost_not_configured' }, { status: 400 });

  // Normalize base URL
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  const firstMsg = thread.messages[0];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
  const threadUrl = `${appUrl}/threads/${thread.id}`;

  const text = [
    `### 📧 ${thread.subject}`,
    `**メールアカウント:** ${thread.mailbox.display_name}`,
    firstMsg ? `**送信者:** ${firstMsg.from_name ? `${firstMsg.from_name} <${firstMsg.from_email}>` : firstMsg.from_email}` : '',
    `**スレッドを開く:** ${threadUrl}`,
    firstMsg?.text_body ? `\n---\n${firstMsg.text_body.slice(0, 500)}${firstMsg.text_body.length > 500 ? '…' : ''}` : ''
  ].filter(Boolean).join('\n');

  try {
    const mmRes = await fetch(`${cleanBaseUrl}/api/v4/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
      body: JSON.stringify({ channel_id: channelId, message: text })
    });

    if (!mmRes.ok) {
      const errText = await mmRes.text();
      console.error('Mattermost API error:', mmRes.status, errText);
      return NextResponse.json({ error: 'mattermost_api_error', status: mmRes.status, detail: errText }, { status: 500 });
    }

    const post = await mmRes.json();

    // Record the link
    await prisma.mattermost_links.upsert({
      where: { thread_id: id },
      create: {
        thread_id: id,
        mattermost_channel_id: channelId,
        mattermost_post_id: post.id,
        mattermost_root_post_id: post.id,
        permalink: `${cleanBaseUrl}/_redirect/pl/${post.id}`,
        created_by_user_id: session!.userId
      },
      update: {
        mattermost_channel_id: channelId,
        mattermost_post_id: post.id,
        mattermost_root_post_id: post.id,
        permalink: `${cleanBaseUrl}/_redirect/pl/${post.id}`
      }
    });

    await logAudit({
      actorUserId: session!.userId,
      actionType: 'mm_discuss',
      targetType: 'threads',
      targetId: id,
      metadata: { channel_id: channelId, post_id: post.id }
    });

    return NextResponse.json({ ok: true, permalink: `${cleanBaseUrl}/_redirect/pl/${post.id}` });
  } catch (e: any) {
    console.error('Mattermost fetch failed:', e);
    return NextResponse.json({ error: 'fetch_failed', detail: String(e) }, { status: 500 });
  }
}
