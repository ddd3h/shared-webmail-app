import { prisma } from '@/lib/db';

export type AppSettingKey =
  | 'VAPID_PUBLIC_KEY'
  | 'VAPID_PRIVATE_KEY'
  | 'VAPID_SUBJECT'
  | 'MATTERMOST_BASE_URL'
  | 'MATTERMOST_BOT_TOKEN'
  | 'MATTERMOST_DEFAULT_CHANNEL_ID'
  | 'SYNC_DEFAULT_INTERVAL_SEC'
  | 'OPENROUTER_API_KEY'
  | 'OPENROUTER_MODEL'
  | 'NEXT_PUBLIC_APP_URL'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'SESSION_SECRET'
  | 'ENCRYPTION_KEY_HEX'
  | 'EMAIL_CONNECT_TIMEOUT_MS'
  | 'CRON_SECRET'
  | 'REDIS_URL'
  | 'DEFAULT_SIGNATURE_TEMPLATE'
  | 'NEXT_PUBLIC_DEFAULT_IMAP_HOST'
  | 'NEXT_PUBLIC_DEFAULT_IMAP_PORT'
  | 'NEXT_PUBLIC_DEFAULT_IMAP_SECURE'
  | 'NEXT_PUBLIC_DEFAULT_SMTP_HOST'
  | 'NEXT_PUBLIC_DEFAULT_SMTP_PORT'
  | 'NEXT_PUBLIC_DEFAULT_SMTP_SECURE'
  | 'NOTIFY_SMTP_HOST'
  | 'NOTIFY_SMTP_PORT'
  | 'NOTIFY_SMTP_SECURE'
  | 'NOTIFY_SMTP_USER'
  | 'NOTIFY_SMTP_PASS'
  | 'NOTIFY_FROM_EMAIL'
  | 'NOTIFY_ADMIN_EMAIL';

export const SECRET_SETTING_KEYS = new Set<AppSettingKey>([
  'VAPID_PRIVATE_KEY',
  'MATTERMOST_BOT_TOKEN',
  'OPENROUTER_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY_HEX',
  'CRON_SECRET',
  'NOTIFY_SMTP_PASS',
]);

export const MANAGED_SETTING_KEYS: AppSettingKey[] = [
  'NEXT_PUBLIC_APP_URL',
  'SESSION_SECRET',
  'ENCRYPTION_KEY_HEX',
  'EMAIL_CONNECT_TIMEOUT_MS',
  'CRON_SECRET',
  'REDIS_URL',
  'DEFAULT_SIGNATURE_TEMPLATE',
  'SYNC_DEFAULT_INTERVAL_SEC',
  'NEXT_PUBLIC_DEFAULT_IMAP_HOST',
  'NEXT_PUBLIC_DEFAULT_IMAP_PORT',
  'NEXT_PUBLIC_DEFAULT_IMAP_SECURE',
  'NEXT_PUBLIC_DEFAULT_SMTP_HOST',
  'NEXT_PUBLIC_DEFAULT_SMTP_PORT',
  'NEXT_PUBLIC_DEFAULT_SMTP_SECURE',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'MATTERMOST_BASE_URL',
  'MATTERMOST_BOT_TOKEN',
  'MATTERMOST_DEFAULT_CHANNEL_ID',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NOTIFY_SMTP_HOST',
  'NOTIFY_SMTP_PORT',
  'NOTIFY_SMTP_SECURE',
  'NOTIFY_SMTP_USER',
  'NOTIFY_SMTP_PASS',
  'NOTIFY_FROM_EMAIL',
  'NOTIFY_ADMIN_EMAIL',
];

export async function getSetting(key: AppSettingKey) {
  const row = await prisma.app_settings.findUnique({ where: { key } });
  return row?.value ?? process.env[key] ?? null;
}

export async function setSetting(key: AppSettingKey, value: string, isSecret = false, updatedBy?: string) {
  await prisma.app_settings.upsert({
    where: { key },
    create: { key, value, is_secret: isSecret, updated_by: updatedBy ?? null },
    update: { value, is_secret: isSecret, updated_by: updatedBy ?? null }
  });
}

export async function getAllSettings() {
  const rows = await prisma.app_settings.findMany();
  return rows;
}
