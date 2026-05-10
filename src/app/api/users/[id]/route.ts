import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { logAudit } from '@/lib/audit';
import { clearAvatarCache } from '@/lib/avatar-cache';
import { z } from 'zod';

// PUT /api/users/[id] - edit user (admin only)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const actor = await prisma.users.findUnique({ where: { id: session.userId } });
  if (actor?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const schema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.enum(['user', 'admin']).optional(),
    password: z.string().min(8).optional(),
    mattermost_user_id: z.string().nullable().optional(),
  });

  const body = await req.json().catch(() => ({}));
  const result = schema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: 'bad_request', details: result.error.format() }, { status: 400 });
  }
  const input = result.data;

  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (input.email) {
    // Check for email uniqueness manually to provide better error
    const existing = await prisma.users.findUnique({ where: { email: input.email } });
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: 'email_already_exists' }, { status: 400 });
    }
    data.email = input.email;
  }
  if (input.role) data.role = input.role;
  if (input.password) data.password_hash = await hashPassword(input.password);
  
  const mattermostIdChanged = 'mattermost_user_id' in input;
  if (mattermostIdChanged) data.mattermost_user_id = input.mattermost_user_id || null;

  try {
    const updated = await prisma.users.update({ where: { id }, data });

    // Clear avatar cache so the new Mattermost ID's image is fetched immediately
    if (mattermostIdChanged) clearAvatarCache(id).catch(() => {});

    await logAudit({
      actorUserId: session.userId,
      actionType: 'update_user',
      targetType: 'users',
      targetId: id,
      metadata: { fields: Object.keys(data) }
    });

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e: any) {
    console.error('Update user error:', e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

// DELETE /api/users/[id] - delete user (admin only, cannot delete self)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const actor = await prisma.users.findUnique({ where: { id: session.userId } });
  if (actor?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (id === session.userId) {
    return NextResponse.json({ error: 'cannot_delete_self' }, { status: 400 });
  }

  const target = await prisma.users.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await logAudit({
    actorUserId: session.userId,
    actionType: 'delete_user',
    targetType: 'users',
    targetId: id,
    metadata: { email: target.email }
  });

  // Nullify relations before delete to avoid FK constraint errors
  await prisma.$transaction([
    prisma.threads.updateMany({ where: { assigned_user_id: id }, data: { assigned_user_id: null } }),
    prisma.threads.updateMany({ where: { last_replied_by_user_id: id }, data: { last_replied_by_user_id: null } }),
    prisma.mailboxes.updateMany({ where: { owner_user_id: id }, data: { owner_user_id: null } }),
    prisma.mailbox_permissions.deleteMany({ where: { user_id: id } }),
    prisma.push_subscriptions.deleteMany({ where: { user_id: id } }),
    prisma.thread_visibility.deleteMany({ where: { user_id: id } }),
    prisma.drafts.deleteMany({ where: { user_id: id } }),
    prisma.users.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
