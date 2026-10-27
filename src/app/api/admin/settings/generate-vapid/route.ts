import { NextResponse } from 'next/server';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { generateVapidKeys } from '@/lib/vapid';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

export async function POST() {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const keys = await generateVapidKeys();
  await setSetting('VAPID_PUBLIC_KEY', keys.publicKey, false, actor.id);
  await setSetting('VAPID_PRIVATE_KEY', keys.privateKey, true, actor.id);
  await logAudit({ actorUserId: actor.id, actionType: 'generate_vapid', targetType: 'app_settings' });
  return NextResponse.json({ publicKey: keys.publicKey });
}

