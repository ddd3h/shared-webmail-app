import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sendMfiBelowThresholdDm } from '@/lib/mattermost-dm';

// POST /api/mfi/test-notification — send MFI DM immediately, bypassing the 12h throttle
export async function POST() {
  const session = await getSession();
  requireAuth(session);

  const user = await prisma.users.findUnique({
    where: { id: session!.userId },
    select: { email: true }
  });

  if (!user?.email) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  // Delete any recent throttle record so the send is not blocked
  await prisma.mattermost_notifications.deleteMany({
    where: { user_id: session!.userId, notification_type: 'mfi_low' }
  });

  const sent = await sendMfiBelowThresholdDm(session!.userId, user.email, 42.0);

  if (!sent) {
    return NextResponse.json(
      { error: 'send_failed', hint: 'MATTERMOST_BASE_URL / MATTERMOST_BOT_TOKEN が未設定か、Mattermostにアカウントが見つかりません' },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}
