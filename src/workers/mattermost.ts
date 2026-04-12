// Mattermost Worker スタブ（ログ記録 + DB 状態更新のみ）
import { queues } from '@/lib/queue';
import { prisma } from '@/lib/db';

async function main() {
  queues.mattermost.process?.(async (job) => {
    console.log('[mm] job', job.data);
    const data: any = job.data;
    if (data.type === 'assigned') {
      await prisma.mattermost_notifications.create({ data: { user_id: data.userId, notification_type: 'assigned', target_mattermost_id: data.userId, status: 'success' } });
    } else if (data.type === 'forward') {
      // In real impl, send to Mattermost REST; here we just mark a success log row
      await prisma.mattermost_notifications.create({ data: { user_id: data.userId, notification_type: 'forward', target_mattermost_id: data.userId, status: 'success' } });
    }
  });
  console.log('Mattermost worker started (stub)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
