import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { createHash } from 'crypto';
import { revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { passwordProblem } from '@/lib/password-policy';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// POST /api/profile/password-reset  { token, newPassword }
export async function POST(req: NextRequest) {
  const { token, newPassword } = await req.json().catch(() => ({}));
  if (!token || !newPassword) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if (typeof token !== 'string' || typeof newPassword !== 'string') return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // Look up by hash — the raw token is never stored in the DB
  const tokenHash = hashToken(token);
  const record = await prisma.password_reset_tokens.findUnique({ where: { token_hash: tokenHash } });
  if (!record || record.used || record.expires_at < new Date()) {
    return NextResponse.json({ error: 'token_invalid' }, { status: 400 });
  }

  const owner = await prisma.users.findUnique({ where: { id: record.user_id }, select: { email: true, name: true } });
  const problem = passwordProblem(newPassword, { email: owner?.email, name: owner?.name });
  if (problem) return NextResponse.json({ error: 'password_weak', message: problem }, { status: 400 });

  const hash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.users.update({ where: { id: record.user_id }, data: { password_hash: hash } }),
    prisma.password_reset_tokens.update({ where: { id: record.id }, data: { used: true } })
  ]);

  // a reset means the old password may have been known to somebody else: every session ends
  const ended = await revokeUserSessions(record.user_id);
  await logAudit({ actorUserId: record.user_id, actionType: 'password_reset', targetType: 'users', targetId: record.user_id, metadata: { sessions_ended: ended } });
  return NextResponse.json({ ok: true });
}
