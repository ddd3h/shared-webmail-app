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
  | 'OPENROUTER_MODEL';

export async function getSetting(key: AppSettingKey) {
  const row = await prisma.app_settings.findUnique({ where: { key } });
  return row?.value ?? null;
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

