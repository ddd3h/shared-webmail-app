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
  | 'GOOGLE_CLIENT_SECRET';

export const SECRET_SETTING_KEYS = new Set<AppSettingKey>([
  'VAPID_PRIVATE_KEY',
  'MATTERMOST_BOT_TOKEN',
  'OPENROUTER_API_KEY',
  'GOOGLE_CLIENT_SECRET',
]);

export const MANAGED_SETTING_KEYS: AppSettingKey[] = [
  'NEXT_PUBLIC_APP_URL',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'MATTERMOST_BASE_URL',
  'MATTERMOST_BOT_TOKEN',
  'MATTERMOST_DEFAULT_CHANNEL_ID',
  'SYNC_DEFAULT_INTERVAL_SEC',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
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
