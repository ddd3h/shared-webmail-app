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

// Neutralise mail-controlled text before embedding it in a Mattermost post:
// no @mentions / channel pings, no markdown links or formatting, single line.
function mmText(s: string, max = 80): string {
  const flat = s.replace(/[\r\n\t]+/g, ' ').trim();
  const cut = flat.length > max ? flat.slice(0, max) + '…' : flat;
  return cut
    .replace(/([\\`*_{}\[\]()<>#+!|~])/g, '\\$1')
    .replace(/@/g, '@\u200b');
}

const STALE_UNREAD_THROTTLE_MS = 6 * 24 * 3600 * 1000;
const STALE_UNREAD_LIST_MAX = 10;

export async function sendStaleUnreadDm(
  userId: string,
  email: string,
  threads: { thread_id: string; subject: string; oldest_unread_at: Date }[]
): Promise<boolean> {
  if (threads.length === 0) return false;

  const { baseUrl, token } = await getConfig();
  if (!baseUrl || !token) return false;

  // Throttle across restarts: at most one DM per ~week per user
  const recent = await prisma.mattermost_notifications.findFirst({
    where: {
      user_id: userId,
      notification_type: 'stale_unread',
      created_at: { gte: new Date(Date.now() - STALE_UNREAD_THROTTLE_MS) },
    },
  });
  if (recent) return false;

  const mmUserId = await resolveMmUserId(userId, email, baseUrl, token);
  if (!mmUserId) return false;

  const botId = await getBotUserId(baseUrl, token);
  const channel = await mmFetch(baseUrl, token, '/channels/direct', {
    method: 'POST',
    body: JSON.stringify([botId, mmUserId]),
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
  });
  const lines = threads.slice(0, STALE_UNREAD_LIST_MAX).map(t =>
    `- ${fmt.format(t.oldest_unread_at)}〜 [${mmText(t.subject || '(件名なし)')}](${appUrl}/threads/${encodeURIComponent(t.thread_id)})`
  );
  const rest = threads.length - lines.length;

  const message =
    `📬 **1週間以上放置された未読メールが ${threads.length} 件あります**\n\n` +
    lines.join('\n') + '\n' +
    (rest > 0 ? `…ほか ${rest} 件\n` : '') +
    `\n未読一覧: ${appUrl}/threads?unread=1`;

  await mmFetch(baseUrl, token, '/posts', {
    method: 'POST',
    body: JSON.stringify({ channel_id: channel.id, message }),
  });

  await prisma.mattermost_notifications.create({
    data: {
      user_id: userId,
      notification_type: 'stale_unread',
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
