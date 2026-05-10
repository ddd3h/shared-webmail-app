import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { logAudit } from '@/lib/audit';

function canManage(role: string, ownerId: string | null, userId: string, mailboxType: string) {
  if (role === 'admin') return true;
  if (mailboxType === 'team') return false; // team mailbox: admin only
  return ownerId === userId; // personal: owner only
}

// GET /api/mailboxes/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const mb = await prisma.mailboxes.findUnique({ where: { id }, include: { credentials: true } });
  if (!mb) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManage(session.role, mb.owner_user_id, session.userId, mb.type)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    id: mb.id,
    type: mb.type,
    display_name: mb.display_name,
    sender_name: mb.sender_name,
    email_address: mb.email_address,
    is_active: mb.is_active,
    sync_mode: mb.sync_mode,
    mattermost_channel_id: mb.mattermost_channel_id,
    credentials: mb.credentials ? {
      username: mb.credentials.username,
      imap_host: mb.credentials.imap_host,
      imap_port: mb.credentials.imap_port,
      imap_secure: mb.credentials.imap_secure,
      smtp_host: mb.credentials.smtp_host,
      smtp_port: mb.credentials.smtp_port,
      smtp_secure: mb.credentials.smtp_secure
    } : null
  });
}

// PUT /api/mailboxes/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: mailboxId } = await params;
  const session = await getSession();
  requireAuth(session);
  const mb = await prisma.mailboxes.findUnique({ where: { id: mailboxId } });
  if (!mb) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManage(session.role, mb.owner_user_id, session.userId, mb.type)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const updates: any = {};
  if (typeof body.display_name === 'string') updates.display_name = body.display_name;
  if (typeof body.sender_name === 'string') updates.sender_name = body.sender_name || null;
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;
  if (body.sync_mode === 'poll' || body.sync_mode === 'idle') updates.sync_mode = body.sync_mode;
  if ('mattermost_channel_id' in body) updates.mattermost_channel_id = body.mattermost_channel_id || null;
  if (body.type === 'personal' || body.type === 'team') {
    if (body.type === 'team' && session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    updates.type = body.type;
    if (body.type === 'team') updates.owner_user_id = null;
  }
  // Admin can reassign personal mailbox owner
  if (session.role === 'admin' && 'owner_user_id' in body) {
    updates.owner_user_id = body.owner_user_id || null;
  }
  const tx: any[] = [prisma.mailboxes.update({ where: { id: mailboxId }, data: updates })];
  if (body.credentials) {
    const c = body.credentials;
    const data: any = {};
    if (typeof c.username === 'string') data.username = c.username;
    if (typeof c.password === 'string' && c.password) data.encrypted_password = await encrypt(c.password);
    if (c.imap) { data.imap_host = c.imap.host; data.imap_port = c.imap.port; data.imap_secure = !!c.imap.secure; }
    if (c.smtp) { data.smtp_host = c.smtp.host; data.smtp_port = c.smtp.port; data.smtp_secure = !!c.smtp.secure; }
    tx.push(prisma.mailbox_credentials.update({ where: { mailbox_id: mailboxId }, data }));
  }
  await prisma.$transaction(tx);
  await logAudit({ actorUserId: session.userId, actionType: 'update_mailbox', targetType: 'mailboxes', targetId: mailboxId, metadata: {} });
  return NextResponse.json({ ok: true });
}

// DELETE /api/mailboxes/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const mb = await prisma.mailboxes.findUnique({ where: { id } });
  if (!mb) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManage(session.role, mb.owner_user_id, session.userId, mb.type)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await logAudit({ actorUserId: session.userId, actionType: 'delete_mailbox', targetType: 'mailboxes', targetId: id, metadata: { email: mb.email_address } });

  // Pre-fetch IDs needed for tables that lack a direct mailbox_id FK
  const [threadRows, messageRows] = await Promise.all([
    prisma.threads.findMany({ where: { mailbox_id: id }, select: { id: true } }),
    prisma.messages.findMany({ where: { mailbox_id: id }, select: { id: true } }),
  ]);
  const threadIds = threadRows.map(t => t.id);
  const messageIds = messageRows.map(m => m.id);
  const notifEventIds = threadIds.length > 0
    ? (await prisma.notification_events.findMany({ where: { thread_id: { in: threadIds } }, select: { id: true } })).map(n => n.id)
    : [];

  // Delete in FK dependency order (children before parents)
  await prisma.$transaction(async (tx) => {
    if (notifEventIds.length > 0) {
      await tx.notification_deliveries.deleteMany({ where: { notification_event_id: { in: notifEventIds } } });
    }
    await tx.notification_events.deleteMany({ where: { thread_id: { in: threadIds } } });
    await tx.mattermost_forwards.deleteMany({ where: { thread_id: { in: threadIds } } });
    await tx.mattermost_notifications.deleteMany({ where: { thread_id: { in: threadIds } } });
    await tx.mattermost_links.deleteMany({ where: { thread_id: { in: threadIds } } });
    await tx.thread_assignments.deleteMany({ where: { thread_id: { in: threadIds } } });
    await tx.thread_state_history.deleteMany({ where: { thread_id: { in: threadIds } } });
    await tx.thread_visibility.deleteMany({ where: { thread_id: { in: threadIds } } });
    await tx.message_sends.deleteMany({ where: { mailbox_id: id } });
    await tx.attachments.deleteMany({ where: { message_id: { in: messageIds } } });
    await tx.messages.deleteMany({ where: { mailbox_id: id } });
    await tx.drafts.deleteMany({ where: { mailbox_id: id } });
    await tx.threads.deleteMany({ where: { mailbox_id: id } });
    await tx.mailbox_sync_states.deleteMany({ where: { mailbox_id: id } });
    await tx.mailbox_permissions.deleteMany({ where: { mailbox_id: id } });
    await tx.mailbox_credentials.deleteMany({ where: { mailbox_id: id } });
    await tx.mailboxes.delete({ where: { id } });
  }, { timeout: 30000 });

  return NextResponse.json({ ok: true });
}
