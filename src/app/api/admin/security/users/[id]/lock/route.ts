import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { recordSecurityEvent } from '@/lib/security-events';

const schema = z.object({ locked: z.boolean() });

// POST /api/admin/security/users/:id/lock { locked } - stop (or allow again) an account from logging in; locking ends its sessions
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const target = await prisma.users.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (parsed.data.locked) {
    if (target.id === actor.id) return NextResponse.json({ error: 'lock_self', message: '自分自身はロックできません' }, { status: 409 });
    if (target.role === 'admin' && (await prisma.users.count({ where: { role: 'admin', locked_at: null, id: { not: id } } })) === 0) {
      return NextResponse.json({ error: 'last_admin', message: '最後の管理者はロックできません' }, { status: 409 });
    }
  }
  await prisma.users.update({ where: { id }, data: { locked_at: parsed.data.locked ? new Date() : null } });
  const ended = parsed.data.locked ? await revokeUserSessions(id) : 0;
  await logAudit({ actorUserId: actor.id, actionType: parsed.data.locked ? 'user_lock' : 'user_unlock', targetType: 'users', targetId: id, metadata: { sessions_ended: ended } });
  await recordSecurityEvent({ type: parsed.data.locked ? 'user_locked' : 'user_unlocked', severity: 'warn', userId: id, email: target.email, detail: { by: actor.id } });
  return NextResponse.json({ ok: true, ended });
}
