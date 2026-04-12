import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { generateVapidKeys } from '@/lib/vapid';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

export async function POST() {
  const session = await getSession();
  requireAuth(session);
  const keys = await generateVapidKeys();
  await setSetting('VAPID_PUBLIC_KEY', keys.publicKey, false, session!.userId);
  await setSetting('VAPID_PRIVATE_KEY', keys.privateKey, true, session!.userId);
  await logAudit({ actorUserId: session!.userId, actionType: 'generate_vapid', targetType: 'app_settings' });
  return NextResponse.json({ publicKey: keys.publicKey });
}

