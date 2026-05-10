import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// GET /api/threads/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const t = await prisma.threads.findUnique({
    where: { id },
    include: {
      mailbox: true,
      messages: { orderBy: { sent_at: 'asc' }, include: { attachments: true } },
      assigned_user: { select: { name: true, id: true } },
      last_replied_by: { select: { name: true, id: true } },
      mattermost: true
    }
  });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // auth: user must have view rights to the mailbox
  const canView = await prisma.mailboxes.findFirst({
    where: {
      id: t.mailbox_id,
      OR: [
        { type: 'personal', owner_user_id: session!.userId },
        { permissions: { some: { user_id: session!.userId, can_view: true } } }
      ]
    }
  });
  if (!canView) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const isOwner = t.mailbox.type === 'personal' && t.mailbox.owner_user_id === session!.userId;

  // Resolve effective permissions for the current user
  let permissions = { can_view: true, can_reply: true, can_assign: true };
  if (!isOwner) {
    const perm = await prisma.mailbox_permissions.findFirst({
      where: { mailbox_id: t.mailbox_id, user_id: session!.userId }
    });
    permissions = {
      can_view: !!perm?.can_view,
      can_reply: !!perm?.can_reply,
      can_assign: !!perm?.can_assign
    };
  }

  return NextResponse.json({
    id: t.id,
    subject: t.subject,
    status: t.status,
    permissions,
    mailbox: { id: t.mailbox_id, name: t.mailbox.display_name, type: t.mailbox.type, email_address: t.mailbox.email_address, mattermost_channel_id: t.mailbox.mattermost_channel_id },
    assigned_user: t.assigned_user ? { id: t.assigned_user.id, name: t.assigned_user.name } : null,
    last_replied_by: t.last_replied_by ? { id: t.last_replied_by.id, name: t.last_replied_by.name } : null,
    mattermost: t.mattermost?.permalink || null,
    messages: t.messages.map(m => ({
      id: m.id,
      direction: m.direction,
      from: { name: m.from_name, email: m.from_email },
      to: m.to_raw,
      cc: m.cc_raw,
      subject: m.subject,
      sent_at: m.sent_at,
      received_at: m.received_at,
      text_body: m.text_body,
      html_body: m.html_body,
      has_attachments: m.has_attachments,
      attachments: m.attachments.map(a => ({ id: a.id, filename: a.filename, size: a.size, content_type: a.content_type }))
    }))
  });
}
