import webpush from 'web-push';
import { getSetting } from '@/lib/settings';
import { prisma } from '@/lib/db';

export async function ensureWebPushConfigured() {
  const publicKey = await getSetting('VAPID_PUBLIC_KEY');
  const privateKey = await getSetting('VAPID_PRIVATE_KEY');
  const subject = (await getSetting('VAPID_SUBJECT')) || 'mailto:admin@example.com';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys not configured');
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (e: any) {
    throw new Error(`Invalid VAPID keys: ${e?.message || e}`);
  }
}

export async function sendWebPushToUser(userId: string, payload: any) {
  await ensureWebPushConfigured();
  const subs = await prisma.push_subscriptions.findMany({ where: { user_id: userId, is_active: true } });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any, JSON.stringify(payload));
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/410|404/.test(e?.statusCode?.toString?.() || '')) {
        await prisma.push_subscriptions.update({ where: { id: s.id }, data: { is_active: false } });
      }
      console.error('push failed', s.id, msg);
    }
  }
}

