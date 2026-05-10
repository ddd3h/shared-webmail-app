// Mattermost DM sender — looks up user by email, creates DM channel, posts message
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';

async function getConfig() {
  const [baseUrl, token] = await Promise.all([
    getSetting('MATTERMOST_BASE_URL'),
    getSetting('MATTERMOST_BOT_TOKEN'),
  ]);
  return {
    baseUrl: (baseUrl || process.env.MATTERMOST_BASE_URL || '').replace(/\/$/, ''),
    token: token || process.env.MATTERMOST_BOT_TOKEN || '',
  };
}

async function mmFetch(baseUrl: string, token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}/api/v4${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Mattermost API ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// Get bot's own user ID (cached per process)
let _botUserId: string | null = null;
async function getBotUserId(baseUrl: string, token: string): Promise<string> {
  if (_botUserId) return _botUserId;
  const me = await mmFetch(baseUrl, token, '/users/me');
  _botUserId = me.id;
  return me.id;
}

// Resolve Mattermost user ID for one of our users (by email), cache in DB
async function resolveMmUserId(
  userId: string,
  email: string,
  baseUrl: string,
  token: string
): Promise<string | null> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { mattermost_user_id: true },
  });
  if (user?.mattermost_user_id) return user.mattermost_user_id;

  try {
    const mmUser = await mmFetch(baseUrl, token, `/users/email/${encodeURIComponent(email)}`);
    if (mmUser?.id) {
      await prisma.users.update({
        where: { id: userId },
        data: { mattermost_user_id: mmUser.id },
      });
      return mmUser.id;
    }
  } catch {
    // User not found in Mattermost — that's OK
  }
  return null;
}

export async function sendMfiBelowThresholdDm(
  userId: string,
  email: string,
  mfi: number
): Promise<boolean> {
  const { baseUrl, token } = await getConfig();
  if (!baseUrl || !token) return false;

  // Throttle: only send once per 12 hours per user
  const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000);
  const recent = await prisma.mattermost_notifications.findFirst({
    where: {
      user_id: userId,
      notification_type: 'mfi_low',
      created_at: { gte: twelveHoursAgo },
    },
  });
  if (recent) return false;

  const mmUserId = await resolveMmUserId(userId, email, baseUrl, token);
  if (!mmUserId) return false;

  const botId = await getBotUserId(baseUrl, token);

  // Get or create DM channel
  const channel = await mmFetch(baseUrl, token, '/channels/direct', {
    method: 'POST',
    body: JSON.stringify([botId, mmUserId]),
  });

  const message =
    `📬 **メールボックスの健康度（MFI）が低下しています**\n\n` +
    `現在のMFI: **${mfi.toFixed(1)}** / 100\n\n` +
    `未読メールの放置が増えています。メールを確認してInboxを整理しましょう！\n` +
    `ダッシュボードで詳細を確認: ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}`;

  await mmFetch(baseUrl, token, '/posts', {
    method: 'POST',
    body: JSON.stringify({ channel_id: channel.id, message }),
  });

  await prisma.mattermost_notifications.create({
    data: {
      user_id: userId,
      notification_type: 'mfi_low',
      target_mattermost_id: mmUserId,
      status: 'success',
    },
  });

  return true;
}

export async function sendBulkDeleteApprovalDm(
  adminUserId: string,
  adminEmail: string,
  requesterName: string,
  count: number,
  approvalId: string
): Promise<boolean> {
  const { baseUrl, token } = await getConfig();
  if (!baseUrl || !token) return false;

  const mmUserId = await resolveMmUserId(adminUserId, adminEmail, baseUrl, token);
  if (!mmUserId) return false;

  const botId = await getBotUserId(baseUrl, token);
  const channel = await mmFetch(baseUrl, token, '/channels/direct', {
    method: 'POST',
    body: JSON.stringify([botId, mmUserId]),
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const approvalUrl = `${appUrl}/approve-action?id=${approvalId}`;
  
  const message = 
    `⚠️ **共有メールの大量削除リクエスト**\n\n` +
    `**${requesterName}** さんが共有メール **${count}件** の削除をリクエストしました。\n` +
    `この操作には管理者の承認が必要です（有効期限: 5分）。\n\n` +
    `内容を確認して承認する場合は、以下のURLから操作を行ってください：\n` +
    `${approvalUrl}`;

  await mmFetch(baseUrl, token, '/posts', {
    method: 'POST',
    body: JSON.stringify({
      channel_id: channel.id,
      message,
    }),
  });

  return true;
}
