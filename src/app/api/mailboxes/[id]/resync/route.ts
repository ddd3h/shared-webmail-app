import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { canViewMailbox } from '@/lib/rbac';
import { syncMailbox } from '@/lib/mail/sync';
import { logAudit } from '@/lib/audit';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  if (!(await canViewMailbox(session!.userId, id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await logAudit({
    actorUserId: session!.userId,
    actionType: 'sync_started',
    targetType: 'mailboxes',
    targetId: id,
    metadata: {}
  });

  // Run sync inline (non-blocking background via response)
  // For MVP we run inline but respond immediately
  const resultPromise = syncMailbox(id);

  // Return immediately, sync runs in background
  // We await and log errors asynchronously
  resultPromise.then(({ synced, errors }) => {
    if (errors.length > 0) {
      console.error('[sync] errors for', id, errors);
    } else {
      console.log(`[sync] synced ${synced} messages for`, id);
    }
  }).catch((e) => {
    console.error('[sync] fatal error for', id, e);
  });

  return NextResponse.json({ ok: true, message: '同期を開始しました' });
}
