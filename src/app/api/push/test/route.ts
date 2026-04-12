import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { sendWebPushToUser } from '@/lib/push';

// POST /api/push/test - send a test push to current user
export async function POST() {
  const session = await getSession();
  requireAuth(session);

  try {
    await sendWebPushToUser(session!.userId, {
      type: 'test',
      title: 'テスト通知',
      body: 'プッシュ通知のテストです。正常に動作しています。',
      url: '/'
    });
  } catch (e: any) {
    console.error('push test error', e);
    const isVapid = /VAPID|Invalid VAPID/i.test(e?.message || '');
    return NextResponse.json(
      { error: isVapid ? 'vapid_invalid' : 'send_failed' },
      { status: isVapid ? 503 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
