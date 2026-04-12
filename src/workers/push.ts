// Push Worker 実装（Web Push 配信）
import { queues } from '@/lib/queue';
import { sendWebPushToUser } from '@/lib/push';
import { prisma } from '@/lib/db';

async function main() {
  queues.push.process?.(async (job) => {
    const { userId, title, body, url, priority } = job.data as any;
    try {
      await sendWebPushToUser(userId, { title, body, url, priority });
      const ev = await prisma.notification_events.create({ data: { user_id: userId, thread_id: null, event_type: 'generic', title, body, url, priority: priority as any } });
      await prisma.notification_deliveries.create({ data: { notification_event_id: ev.id, channel: 'webpush', status: 'success', delivered_at: new Date() } });
    } catch (e: any) {
      const ev = await prisma.notification_events.create({ data: { user_id: userId, thread_id: null, event_type: 'generic', title, body, url, priority: priority as any } });
      await prisma.notification_deliveries.create({ data: { notification_event_id: ev.id, channel: 'webpush', status: 'failed', error_message: String(e?.message || e) } });
    }
  });
  console.log('Push worker started (stub)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
