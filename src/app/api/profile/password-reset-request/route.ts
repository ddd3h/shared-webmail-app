import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST /api/profile/password-reset-request
// Creates a reset token and sends it to the user via Mattermost DM.
export async function POST() {
  const session = await getSession();
  requireAuth(session);

  const user = await prisma.users.findUnique({
    where: { id: session!.userId },
    select: { id: true, name: true, mattermost_user_id: true }
  });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!user.mattermost_user_id) {
    return NextResponse.json({ error: 'no_mattermost' }, { status: 422 });
  }

  // Get Mattermost settings
  const settings = await prisma.app_settings.findMany({
    where: { key: { in: ['MATTERMOST_BASE_URL', 'MATTERMOST_BOT_TOKEN'] } }
  });
  const getSetting = (key: string) => settings.find(s => s.key === key)?.value || '';
  const baseUrl = getSetting('MATTERMOST_BASE_URL') || process.env.MATTERMOST_BASE_URL;
  const botToken = getSetting('MATTERMOST_BOT_TOKEN') || process.env.MATTERMOST_BOT_TOKEN;

  if (!baseUrl || !botToken) {
    return NextResponse.json({ error: 'mattermost_not_configured' }, { status: 503 });
  }

  // Invalidate old tokens for this user
  await prisma.password_reset_tokens.updateMany({
    where: { user_id: user.id, used: false },
    data: { used: true }
  });

  // Create a new token (expires in 5 minutes)
  const record = await prisma.password_reset_tokens.create({
    data: {
      user_id: user.id,
      expires_at: new Date(Date.now() + 5 * 60 * 1000)
    }
  });

  // Normalize Mattermost base URL
  const cleanBaseUrl = (baseUrl || '').replace(/\/+$/, '');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const resetUrl = `${appUrl}/reset-password?token=${record.token}`;

  // Get the bot's own user_id
  const meRes = await fetch(`${cleanBaseUrl}/api/v4/users/me`, {
    headers: { Authorization: `Bearer ${botToken}` }
  });
  if (!meRes.ok) return NextResponse.json({ error: 'mattermost_error' }, { status: 502 });
  const botUser = await meRes.json();

  // Create DM channel
  const dmRes = await fetch(`${cleanBaseUrl}/api/v4/channels/direct`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([botUser.id, user.mattermost_user_id])
  });
  if (!dmRes.ok) return NextResponse.json({ error: 'mattermost_dm_failed' }, { status: 502 });
  const dmChannel = await dmRes.json();

  // Send the reset link
  const msg = `### 🔑 パスワードリセット\n\n${user.name} 様、パスワードリセットのリクエストを受け付けました。\n下記のボタンまたはURLからパスワードを変更してください。\n\n**有効期限: 5分間**\n\n[パスワードを変更する](${resetUrl})\n\nURL: ${resetUrl}\n\n心当たりがない場合は、このメッセージを無視してください。セキュリティのため、パスワード変更が完了するまでこのリンクは有効です。`;
  
  await fetch(`${cleanBaseUrl}/api/v4/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_id: dmChannel.id, message: msg })
  });

  return NextResponse.json({ ok: true });
}
