import { checkRateLimit } from '@/lib/rate-limit';
import { sendNotificationEmail } from '@/lib/notify-mail';

// Suppress duplicate alerts: at most 1 email per IP+endpoint per 30 minutes.
const ALERT_WINDOW_MS = 30 * 60 * 1000;
const ALERT_LIMIT = 1;

const ENDPOINT_LABELS: Record<string, string> = {
  'login-ip':        'ログイン（IP単位）',
  'login-email':     'ログイン（メールアドレス単位）',
  'passkey-options': 'パスキーchallenge発行',
  'passkey-auth':    'パスキー認証',
  'cron-sync':       'Cron同期',
};

export async function sendDosAlert(
  ip: string,
  endpoint: string,
  retryAfterSec: number,
  extra?: string
): Promise<void> {
  // Throttle: one alert per ip+endpoint per 30 minutes
  const throttleKey = `dos-alert:${endpoint}:${ip}`;
  const throttle = checkRateLimit(throttleKey, ALERT_LIMIT, ALERT_WINDOW_MS);
  if (!throttle.isFirstBlock && !throttle.allowed) return;

  const label = ENDPOINT_LABELS[endpoint] ?? endpoint;
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const retryMin = Math.ceil(retryAfterSec / 60);

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#f4f4f5;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.12)">
    <div style="background:#dc2626;padding:20px 24px">
      <h1 style="margin:0;color:#fff;font-size:18px">🚨 DoS攻撃検知アラート</h1>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 16px;color:#374151">レート制限が発動しました。攻撃の可能性があります。</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#f9fafb">
          <td style="padding:8px 12px;color:#6b7280;width:140px;border-bottom:1px solid #e5e7eb">検知日時</td>
          <td style="padding:8px 12px;color:#111827;border-bottom:1px solid #e5e7eb"><strong>${now}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:#6b7280;border-bottom:1px solid #e5e7eb">対象エンドポイント</td>
          <td style="padding:8px 12px;color:#111827;border-bottom:1px solid #e5e7eb">${label}</td>
        </tr>
        <tr style="background:#f9fafb">
          <td style="padding:8px 12px;color:#6b7280;border-bottom:1px solid #e5e7eb">送信元IPアドレス</td>
          <td style="padding:8px 12px;font-family:monospace;color:#b91c1c;border-bottom:1px solid #e5e7eb"><strong>${ip}</strong></td>
        </tr>
        ${extra ? `
        <tr>
          <td style="padding:8px 12px;color:#6b7280;border-bottom:1px solid #e5e7eb">詳細</td>
          <td style="padding:8px 12px;color:#374151;border-bottom:1px solid #e5e7eb">${extra}</td>
        </tr>` : ''}
        <tr style="background:#f9fafb">
          <td style="padding:8px 12px;color:#6b7280">ブロック解除まで</td>
          <td style="padding:8px 12px;color:#111827">約 ${retryMin} 分</td>
        </tr>
      </table>
      <div style="margin-top:20px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:13px;color:#991b1b">
        <strong>対処方法:</strong> 攻撃が継続する場合は、NginxまたはファイアウォールでこのIPをブロックしてください。<br>
        <code style="display:block;margin-top:6px;background:#fff;padding:6px 8px;border-radius:4px;font-size:12px">sudo ufw deny from ${ip} to any</code>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">このアラートは同一IP・エンドポイントに対して30分間に1回のみ送信されます。</p>
    </div>
  </div>
</body>
</html>`;

  await sendNotificationEmail(
    `[セキュリティアラート] レート制限発動 — ${label} (${ip})`,
    html
  ).catch(e => console.error('[dos-alert] メール送信失敗:', e?.message));
}
