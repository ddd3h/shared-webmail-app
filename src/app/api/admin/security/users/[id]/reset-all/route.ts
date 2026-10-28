import { NextRequest, NextResponse } from 'next/server';
import { revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { clearTotp } from '@/lib/mfa';
import { sendDirectMessage } from '@/lib/mattermost-dm';
import { ADMIN_RESET_TTL_MIN, adminResetMessage } from '@/lib/admin-reset-message';
import { issueResetToken, resetUrl } from '@/lib/password-reset-token';
import { recordSecurityEvent } from '@/lib/security-events';

// POST /api/admin/security/users/:id/reset-all - the person cannot log in any more (lost device, forgotten password...).
// Removes every way in: passkeys, the authenticator app, the password; ends their sessions; and sends them a one-time link
// (Mattermost DM) to choose a new password. The link is shown to the administrator only when the DM could not be sent.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const target = await prisma.users.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (target.id === actor.id) return NextResponse.json({ error: 'reset_self', message: '自分自身はリセットできません' }, { status: 409 });

  const passkeys = await prisma.passkey_credentials.deleteMany({ where: { user_id: id } });
  await clearTotp(id);
  await prisma.users.update({ where: { id }, data: { password_hash: null } });
  const ended = await revokeUserSessions(id);

  const url = resetUrl(await issueResetToken(id, ADMIN_RESET_TTL_MIN * 60_000));
  const delivered = await sendDirectMessage(id, target.email, adminResetMessage(target.name, url), 'security_admin_reset');

  await logAudit({ actorUserId: actor.id, actionType: 'account_reset_all', targetType: 'users', targetId: id, metadata: { sessions_ended: ended, passkeys_removed: passkeys.count, delivered } });
  await recordSecurityEvent({ type: 'account_reset_all', severity: 'warn', userId: id, email: target.email, detail: { by: actor.id, passkeys_removed: passkeys.count, delivered } });
  return NextResponse.json({ ok: true, ended, passkeys_removed: passkeys.count, delivered, ...(delivered ? {} : { reset_url: url }) });
}
