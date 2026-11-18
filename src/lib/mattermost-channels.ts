// The Mattermost channels the "議論" button may post to: registered by the system admin.
// A public channel is open to anybody who can see the thread; a private one only to the people listed for it (and admins).
import { prisma } from '@/lib/db';

export type UsableChannel = { id: string; channel_id: string; name: string; visibility: string };

/** Channels this person may post to, in the admin's order. */
export async function usableChannels(userId: string, role: string): Promise<UsableChannel[]> {
  return prisma.mattermost_channels.findMany({
    where: role === 'admin' ? {} : { OR: [{ visibility: 'public' }, { users: { some: { user_id: userId } } }] },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: { id: true, channel_id: true, name: true, visibility: true },
  });
}

/** One registered channel, when this person may use it. */
export async function usableChannel(userId: string, role: string, refId: string): Promise<UsableChannel | null> {
  return (await usableChannels(userId, role)).find(c => c.id === refId) ?? null;
}

export async function mattermostConfig(): Promise<{ baseUrl: string; botToken: string } | null> {
  const settings = await prisma.app_settings.findMany({ where: { key: { in: ['MATTERMOST_BASE_URL', 'MATTERMOST_BOT_TOKEN'] } } });
  const baseUrl = settings.find(s => s.key === 'MATTERMOST_BASE_URL')?.value || process.env.MATTERMOST_BASE_URL;
  const botToken = settings.find(s => s.key === 'MATTERMOST_BOT_TOKEN')?.value || process.env.MATTERMOST_BOT_TOKEN;
  return baseUrl && botToken ? { baseUrl: baseUrl.replace(/\/+$/, ''), botToken } : null;
}
