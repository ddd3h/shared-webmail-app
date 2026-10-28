import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { sendDirectMessage } from '@/lib/mattermost-dm';
import { adminNoticeMessage } from '@/lib/admin-reset-message';

const schema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(100), message: z.string().trim().min(1).max(2000) });

// POST /api/admin/security/notify { userIds, message } - a note typed by an administrator, sent to each person as a Mattermost DM
// (it also lands in their notification list in the app). One failure does not stop the others.
export async function POST(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { userIds, message } = parsed.data;

  const users = await prisma.users.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true, email: true } });
  const text = adminNoticeMessage(message);
  const results: { id: string; name: string; delivered: boolean }[] = [];
  for (const u of users) results.push({ id: u.id, name: u.name, delivered: await sendDirectMessage(u.id, u.email, text, 'admin_manual') });

  const delivered = results.filter(r => r.delivered).length;
  await logAudit({ actorUserId: actor.id, actionType: 'admin_manual_dm', targetType: 'users', targetId: null, metadata: { recipients: users.length, delivered, message_head: message.slice(0, 100) } });
  return NextResponse.json({ ok: true, requested: userIds.length, found: users.length, delivered, results });
}
