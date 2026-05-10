import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { z } from 'zod';

// GET /api/mailboxes
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const mine = new URL(req.url).searchParams.get('mine') === '1';
  const isAdmin = session!.role === 'admin';

  // Management context (Admins without 'mine' param): see all mailboxes.
  // Usage context (Everyone else or 'mine' param): see only owned or permitted mailboxes.
  const where = (mine || !isAdmin)
    ? {
        OR: [
          { type: 'personal' as const, owner_user_id: session!.userId },
          { permissions: { some: { user_id: session!.userId, can_view: true } } }
        ]
      }
    : {};

  const boxes = await prisma.mailboxes.findMany({
    where,
    select: {
      id: true, type: true, display_name: true, email_address: true,
      is_active: true, sync_mode: true, created_at: true, updated_at: true, owner_user_id: true,
      owner: { select: { id: true, name: true } },
      sync_state: { select: { status: true, last_sync_started_at: true, last_success_at: true, last_error: true } },
      credentials: { select: { imap_host: true, last_test_status: true, last_tested_at: true } },
      permissions: { select: { user_id: true, can_view: true, can_reply: true, can_assign: true } }
    },
    orderBy: [{ type: 'asc' }, { created_at: 'asc' }]
  });

  const result = boxes.map(mb => {
    const isOwner = mb.type === 'personal' && mb.owner_user_id === session!.userId;
    const p = mb.permissions.find(p => p.user_id === session!.userId);
    
    // Resolve effective permissions:
    // 1. Owners have full access.
    // 2. Others rely on explicit permissions in the database.
    const perms = isOwner ? { can_view: true, can_reply: true, can_assign: true } : {
      can_view: !!p?.can_view,
      can_reply: !!p?.can_reply,
      can_assign: !!p?.can_assign
    };
    
    // Safety & Functionality: 
    // - Regular users: only see their own calculated permissions.
    // - Admins: see their own calculated permissions for interaction (reply/assign), 
    //   BUT also keep the 'permissions' array for management UI.
    const resultItem: any = { ...mb, user_permissions: perms };
    if (!isAdmin) {
      delete resultItem.permissions;
    }
    return resultItem;
  });

  return NextResponse.json({ items: result });
}

// POST /api/mailboxes
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const schema = z.object({
    type: z.enum(['personal', 'team']),
    display_name: z.string().min(1),
    sender_name: z.string().optional(),
    email_address: z.string().email(),
    imap: z.object({ host: z.string(), port: z.number().int(), secure: z.boolean() }),
    smtp: z.object({ host: z.string(), port: z.number().int(), secure: z.boolean() }),
    username: z.string().min(1),
    password: z.string().min(1)
  });
  const body = await req.json().catch(() => ({}));
  const input = schema.parse(body);

  // Team mailboxes: admin only
  if (input.type === 'team' && session!.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const enc = await encrypt(input.password);
  const mailbox = await prisma.mailboxes.create({
    data: {
      type: input.type as any,
      display_name: input.display_name,
      sender_name: input.sender_name || null,
      email_address: input.email_address,
      owner_user_id: input.type === 'personal' ? session!.userId : null,
      is_active: true,
      credentials: {
        create: {
          username: input.username,
          encrypted_password: enc,
          encryption_key_version: process.env.ENCRYPTION_KEY_VERSION || 'v1',
          auth_type: 'password',
          imap_host: input.imap.host,
          imap_port: input.imap.port,
          imap_secure: input.imap.secure,
          smtp_host: input.smtp.host,
          smtp_port: input.smtp.port,
          smtp_secure: input.smtp.secure
        }
      }
    }
  });
  return NextResponse.json({ id: mailbox.id }, { status: 201 });
}
